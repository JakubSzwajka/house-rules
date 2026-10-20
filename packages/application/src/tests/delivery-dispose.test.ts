import { afterAll, expect, it } from "@effect/vitest";
import { defineNode, errorKind, NoInput } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { call, CompositionClosed, defineEntry, endpoint, Refused } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { bindFixture } from "./entry-fixtures.ts";
import { bothFixture } from "./router-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {
  kind: errorKind("unavailable"),
}) {}
const closedBody = { error: { code: "unavailable", message: "Try again shortly." } };
const incoming = { headers: new Headers({ "x-request-id": "dispose" }), url: "https://a.test/" };
const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const pingOf = (run: Effect.Effect<string>) =>
  bindFixture(
    defineEntry(
      defineNode("ping", {
        description: "Answer pong.",
        input: NoInput,
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
      }),
    ),
    () => run,
  );
const make = <E>(
  ping: ReturnType<typeof pingOf>,
  extra: Layer.Layer<never, E>,
  who?: import("../index.ts").WhoSocket,
) => {
  const fixture = bothFixture([ping], {
    endpoints: [endpoint(ping, "GET /ping")],
    extra,
    ...(who === undefined ? {} : { who }),
  });
  disposers.push(fixture.dispose);
  return fixture;
};
const gated = Effect.gen(function* () {
  const events: string[] = [];
  const started = yield* Deferred.make<void>();
  const never = yield* Deferred.make<void>();
  const layer = Layer.effectDiscard(
    Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        events.push("released");
      }),
    ),
  );
  const blocked = Deferred.succeed(started, undefined).pipe(
    Effect.andThen(Deferred.await(never)),
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        events.push("interrupted");
      }),
    ),
  );
  return { events, started, layer, blocked };
});
it.effect("dispose interrupts a running call before layer release and answers 503", () =>
  Effect.gen(function* () {
    const { events, started, layer, blocked } = yield* gated;
    const ping = pingOf(blocked.pipe(Effect.as("ok")));
    const fixture = make(ping, layer);
    const pending = call(fixture.app, ping, {}, incoming, { way: "web" });
    yield* Deferred.await(started);
    yield* Effect.promise(fixture.app.dispose);
    expect(events).toEqual(["interrupted", "released"]);
    const outcome = yield* Effect.promise(() => pending);
    if (outcome.ok) return expect.unreachable();
    expect(outcome.error).toBeInstanceOf(CompositionClosed);
    expect(outcome.view).toEqual({ status: 503, code: "unavailable", body: closedBody });
  }),
);
it.effect("dispose interrupts a running HTTP request before layer release", () =>
  Effect.gen(function* () {
    const { events, started, layer, blocked } = yield* gated;
    const fixture = make(pingOf(blocked.pipe(Effect.as("ok"))), layer);
    const pending = fixture.handler(
      webRequest("https://a.test/ping", { headers: { "x-request-id": "f" } }),
    );
    yield* Deferred.await(started);
    yield* Effect.promise(fixture.app.dispose);
    expect(events).toEqual(["interrupted", "released"]);
    const response = yield* Effect.promise(() => pending);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("f");
    expect(yield* Effect.promise(() => response.json())).toEqual(closedBody);
  }),
);
it.effect("dispose interrupts MCP admission before layer release", () =>
  Effect.gen(function* () {
    const { events, started, layer, blocked } = yield* gated;
    const fixture = make(pingOf(Effect.succeed("ok")), layer, {
      resolve: () =>
        blocked.pipe(
          Effect.andThen(Effect.fail(new Refused({ status: 401, code: "no", message: "No." }))),
        ),
    });
    const pending = yield* Effect.forkChild(
      mcpPost(fixture.handler, { authorization: "Bearer fixture" }, mcpInitialize),
    );
    yield* Deferred.await(started);
    yield* Effect.promise(fixture.app.dispose);
    expect(events).toEqual(["interrupted", "released"]);
    expect((yield* Fiber.join(pending)).status).toBe(503);
  }),
);
it.effect("dispose interrupts an MCP tool before layer release", () =>
  Effect.gen(function* () {
    const { events, started, layer, blocked } = yield* gated;
    const fixture = make(pingOf(blocked.pipe(Effect.as("ok"))), layer);
    const session = yield* openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
    const pending = yield* Effect.forkChild(callMcpTool(fixture.handler, session, "ping", {}));
    yield* Deferred.await(started);
    yield* Effect.promise(fixture.app.dispose);
    expect(events).toEqual(["interrupted", "released"]);
    const { result } = yield* Fiber.join(pending);
    expect(result?.["isError"]).toBe(true);
    expect(JSON.stringify(result)).toContain("Try again shortly.");
  }),
);
it.effect("after dispose call, HTTP and MCP answer 503 without any rebuild", () =>
  Effect.gen(function* () {
    let builds = 0;
    const layer = Layer.effectDiscard(
      Effect.suspend(() => {
        builds += 1;
        return builds === 1 ? Effect.fail(new DbUnavailable()) : Effect.void;
      }),
    );
    const ping = pingOf(Effect.succeed("ok"));
    const fixture = make(ping, layer);
    const failed = yield* Effect.promise(() =>
      call(fixture.app, ping, {}, incoming, { way: "web" }),
    );
    expect(failed.ok ? undefined : failed.error).toBeInstanceOf(DbUnavailable);
    yield* Effect.promise(fixture.app.dispose);
    const viaCall = yield* Effect.promise(() =>
      call(fixture.app, ping, {}, incoming, { way: "web" }),
    );
    expect(viaCall.ok ? undefined : viaCall.view).toEqual({
      status: 503,
      code: "unavailable",
      body: closedBody,
    });
    const viaHttp = yield* answer(fixture.handler, webRequest("https://a.test/ping"));
    expect([viaHttp.status, viaHttp.body]).toEqual([503, closedBody]);
    expect(
      (yield* mcpPost(fixture.handler, { authorization: "Bearer fixture" }, mcpInitialize)).status,
    ).toBe(503);
    expect(builds).toBe(1);
    yield* Effect.promise(fixture.app.dispose);
  }),
);
it.effect("a disposed router retains request ids and no-store on HTTP and MCP", () =>
  Effect.gen(function* () {
    const fixture = make(pingOf(Effect.succeed("ok")), Layer.empty);
    yield* Effect.promise(fixture.handler.dispose);
    for (const path of ["/ping", "/mcp"]) {
      for (const id of ["after-dispose", undefined]) {
        const response = yield* answer(
          fixture.handler,
          webRequest(`https://a.test${path}`, {
            headers: id === undefined ? {} : { "x-request-id": id },
          }),
        );
        expect(response.status).toBe(503);
        expect(response.body).toEqual(closedBody);
        expect(response.headers.get("cache-control")).toBe("no-store");
        if (id === undefined)
          expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/u);
        else expect(response.headers.get("x-request-id")).toBe(id);
      }
    }
  }),
);

it.effect("disposing a pending build answers 503 and never rebuilds", () =>
  Effect.gen(function* () {
    let builds = 0;
    const building = yield* Deferred.make<void>();
    const layer = Layer.effectDiscard(
      Effect.suspend(() => {
        builds += 1;
        return Deferred.succeed(building, undefined).pipe(Effect.andThen(Effect.never));
      }),
    );
    const ping = pingOf(Effect.succeed("ok"));
    const fixture = make(ping, layer);
    const pending = call(fixture.app, ping, {}, incoming, { way: "web" });
    yield* Deferred.await(building);
    yield* Effect.promise(fixture.app.dispose);
    const result = yield* Effect.promise(() => pending);
    expect(result.ok ? undefined : result.error).toBeInstanceOf(CompositionClosed);
    const later = yield* Effect.promise(() =>
      call(fixture.app, ping, {}, incoming, { way: "web" }),
    );
    expect(later.ok ? undefined : later.error).toBeInstanceOf(CompositionClosed);
    expect(builds).toBe(1);
  }),
);
it.effect("concurrent first calls share one successful build", () =>
  Effect.gen(function* () {
    let builds = 0;
    const ping = pingOf(Effect.succeed("ok"));
    const fixture = make(
      ping,
      Layer.effectDiscard(
        Effect.sync(() => {
          builds += 1;
        }),
      ),
    );
    const first = yield* Effect.promise(() =>
      Promise.all(
        Array.from({ length: 10 }, () => call(fixture.app, ping, {}, incoming, { way: "web" })),
      ),
    );
    const again = yield* Effect.promise(() =>
      call(fixture.app, ping, {}, incoming, { way: "web" }),
    );
    expect([...first, again].every((result) => result.ok)).toBe(true);
    expect(builds).toBe(1);
    yield* Effect.promise(fixture.app.dispose);
  }),
);
