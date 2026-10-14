import { afterAll, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import {
  type Caller,
  call,
  CompositionClosed,
  composition,
  defineContract,
  implement,
  NoInput,
  problemView,
  Refused,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
} from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";

class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {}) {}

const layerViews = {
  DbUnavailable: problemView(503, "down", (_error: DbUnavailable) => "Down."),
};

const closedBody = { error: { code: "unavailable", message: "The app is shutting down." } };

const nobody = () => Effect.succeed(Context.empty());

const incoming = { headers: new Headers({ "x-request-id": "dispose" }), url: "https://a.test/" };

const handlers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(handlers.map((dispose) => dispose())));

const pingOf = (run: Effect.Effect<string>) =>
  implement(
    defineContract("ping", {
      description: "Answer pong.",
      input: NoInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: "public",
    }),
    () => run,
  );

const gated = Effect.gen(function* gatedApp() {
  const events: Array<string> = [];
  const started = yield* Deferred.make<void>();
  const never = yield* Deferred.make<void>();
  const layer = Layer.effectDiscard(
    Effect.acquireRelease(Effect.void, () => Effect.sync(() => events.push("released"))),
  );
  const blocked = Deferred.succeed(started, undefined).pipe(
    Effect.andThen(Deferred.await(never)),
    Effect.onInterrupt(() => Effect.sync(() => events.push("interrupted"))),
  );
  return { events, started, layer, blocked };
});

const track = <H extends { dispose: () => Promise<void> }>(handler: H): H => {
  handlers.push(handler.dispose);
  return handler;
};

const get = (handler: (request: Request) => Promise<Response>) =>
  handler(webRequest("https://a.test/ping", { headers: { "x-request-id": "f" } }));

const pingTool = (ping: ReturnType<typeof pingOf>) => [
  tool(ping, { title: "Ping", idempotent: true, openWorld: false }),
];

it.effect("dispose interrupts a running call() before the layer closes, and it answers 503", () =>
  Effect.gen(function* disposeDuringCall() {
    const { events, started, layer, blocked } = yield* gated;
    const app = composition({ layer, caller: nobody });
    const pending = call(app, pingOf(blocked.pipe(Effect.as("ok"))), {}, incoming);
    yield* Deferred.await(started);
    yield* Effect.promise(() => app.dispose());
    expect(events).toEqual(["interrupted", "released"]);
    const outcome = yield* Effect.promise(() => pending);
    if (outcome.ok) return expect.unreachable();
    expect(outcome.error).toBeInstanceOf(CompositionClosed);
    expect(outcome.view).toEqual({ status: 503, body: closedBody });
  }),
);

it.effect("dispose interrupts a running HTTP request before the layer closes", () =>
  Effect.gen(function* disposeDuringFetch() {
    const { events, started, layer, blocked } = yield* gated;
    const app = composition({ layer, caller: nobody });
    const ping = pingOf(blocked.pipe(Effect.as("ok")));
    const pending = get(track(toFetchHandler(app, { routes: [route(ping, "GET /ping")] })));
    yield* Deferred.await(started);
    yield* Effect.promise(() => app.dispose());
    expect(events).toEqual(["interrupted", "released"]);
    const response = yield* Effect.promise(() => pending);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("f");
    expect(yield* Effect.promise(() => response.json())).toEqual(closedBody);
  }),
);

it.effect("dispose interrupts MCP admission before the layer closes", () =>
  Effect.gen(function* disposeDuringAdmission() {
    const { events, started, layer, blocked } = yield* gated;
    const waiting: Caller<never> = () =>
      blocked.pipe(
        Effect.andThen(Effect.fail(new Refused({ status: 401, code: "no", message: "No." }))),
      );
    const app = composition({ layer, caller: waiting });
    const tools = pingTool(pingOf(Effect.succeed("ok")));
    const mcp = track(toMcpHandler(app, { path: "/mcp", name: "t", version: "0", tools }));
    const pending = yield* Effect.forkChild(mcpPost(mcp, {}, mcpInitialize));
    yield* Deferred.await(started);
    yield* Effect.promise(() => app.dispose());
    expect(events).toEqual(["interrupted", "released"]);
    const response = yield* Fiber.join(pending);
    expect(response.status).toBe(503);
  }),
);

it.effect("dispose interrupts a running MCP tool before the layer closes", () =>
  Effect.gen(function* disposeDuringTool() {
    const { events, started, layer, blocked } = yield* gated;
    const app = composition({ layer, caller: nobody });
    const tools = pingTool(pingOf(blocked.pipe(Effect.as("ok"))));
    const mcp = track(toMcpHandler(app, { path: "/mcp", name: "t", version: "0", tools }));
    const session = yield* openMcpSession(mcp);
    const pending = yield* Effect.forkChild(callMcpTool(mcp, session, "ping", {}));
    yield* Deferred.await(started);
    yield* Effect.promise(() => app.dispose());
    expect(events).toEqual(["interrupted", "released"]);
    const { result } = yield* Fiber.join(pending);
    expect(result?.["isError"]).toBe(true);
    expect(JSON.stringify(result)).toContain("The app is shutting down.");
  }),
);

it.effect("after dispose nothing builds again: call, HTTP and MCP answer 503", () =>
  Effect.gen(function* noRebuild() {
    let builds = 0;
    const layer = Layer.effectDiscard(
      Effect.suspend(() => {
        builds += 1;
        return builds === 1 ? Effect.fail(new DbUnavailable()) : Effect.void;
      }),
    );
    const app = composition({ layer, caller: nobody, views: layerViews });
    const ping = pingOf(Effect.succeed("ok"));
    const http = track(toFetchHandler(app, { routes: [route(ping, "GET /ping")] }));
    const tools = pingTool(ping);
    const mcp = track(toMcpHandler(app, { path: "/mcp", name: "t", version: "0", tools }));
    const failed = yield* Effect.promise(() => call(app, ping, {}, incoming));
    expect(failed.ok ? undefined : failed.error).toBeInstanceOf(DbUnavailable);
    yield* Effect.promise(() => app.dispose());
    const viaCall = yield* Effect.promise(() => call(app, ping, {}, incoming));
    expect(viaCall.ok ? undefined : viaCall.view).toEqual({ status: 503, body: closedBody });
    const viaHttp = yield* answer(http, webRequest("https://a.test/ping"));
    expect([viaHttp.status, viaHttp.body]).toEqual([503, closedBody]);
    const viaMcp = yield* mcpPost(mcp, {}, mcpInitialize);
    expect(viaMcp.status).toBe(503);
    expect(builds).toBe(1);
    // A second dispose is the same finished shutdown.
    yield* Effect.promise(() => app.dispose());
  }),
);

it.effect("dispose during a pending build answers 503 and never builds again", () =>
  Effect.gen(function* disposeDuringBuild() {
    let builds = 0;
    const building = yield* Deferred.make<void>();
    const layer = Layer.effectDiscard(
      Effect.suspend(() => {
        builds += 1;
        return Deferred.succeed(building, undefined).pipe(Effect.andThen(Effect.never));
      }),
    );
    const app = composition({ layer, caller: nobody });
    const ping = pingOf(Effect.succeed("ok"));
    const pending = call(app, ping, {}, incoming);
    yield* Deferred.await(building);
    yield* Effect.promise(() => app.dispose());
    const outcome = yield* Effect.promise(() => pending);
    expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(CompositionClosed);
    const later = yield* Effect.promise(() => call(app, ping, {}, incoming));
    expect(later.ok ? undefined : later.error).toBeInstanceOf(CompositionClosed);
    expect(builds).toBe(1);
  }),
);

it.effect("concurrent first requests share one build, and a success is kept", () =>
  Effect.gen(function* sharedBuild() {
    let builds = 0;
    const layer = Layer.effectDiscard(Effect.sync(() => (builds += 1)));
    const app = composition({ layer, caller: nobody });
    const ping = pingOf(Effect.succeed("ok"));
    const first = yield* Effect.promise(() =>
      Promise.all(Array.from({ length: 10 }, () => call(app, ping, {}, incoming))),
    );
    const again = yield* Effect.promise(() => call(app, ping, {}, incoming));
    expect([...first, again].every((outcome) => outcome.ok)).toBe(true);
    expect(builds).toBe(1);
    yield* Effect.promise(() => app.dispose());
  }),
);
