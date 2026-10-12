import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import {
  call,
  composition,
  defineContract,
  implement,
  NoInput,
  problemView,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
} from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { mcpInitialize, mcpPost } from "./delivery-mcp-client.ts";

class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {}) {}

const ping = implement(
  defineContract("ping", {
    description: "Answer pong.",
    input: NoInput,
    output: Schema.Struct({ pong: Schema.Boolean }),
    failure: Schema.Never,
    permission: "public",
    annotations: { readOnly: true },
  }),
  () => Effect.succeed({ pong: true }),
);

const layerViews = {
  DbUnavailable: problemView(503, "unavailable", (_error: DbUnavailable) => "Try again shortly."),
};

const unavailable = { error: { code: "unavailable", message: "Try again shortly." } };

const internal = {
  error: { code: "internal_error", message: "Something went wrong on the server." },
};

const flaky = (failures: number) => {
  const builds = { count: 0 };
  const layer = Layer.effectDiscard(
    Effect.suspend(() => {
      builds.count += 1;
      return builds.count <= failures ? Effect.fail(new DbUnavailable()) : Effect.void;
    }),
  );
  return { layer, builds };
};

const nobody = () => Effect.succeed(Context.empty());
const incoming = (id: string) => ({
  headers: new Headers({ "x-request-id": id }),
  url: "https://app.example/",
});

const down = composition({ layer: flaky(Infinity).layer, caller: nobody, views: layerViews });
const dyingLayer: Layer.Layer<never, DbUnavailable> = Layer.effectDiscard(Effect.die("a bug"));
const dying = composition({ layer: dyingLayer, caller: nobody, views: layerViews });
const disposers: Array<() => Promise<void>> = [down.dispose, dying.dispose];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));

const fetchOf = (app: typeof down) => {
  const handler = toFetchHandler(app, { routes: [route(ping, "GET /ping")] });
  disposers.unshift(handler.dispose);
  return (id: string) =>
    answer(handler, webRequest("https://app.example/ping", { headers: { "x-request-id": id } }));
};

const mcpOf = (app: typeof down) => {
  const handler = toMcpHandler(app, {
    path: "/mcp",
    name: "test",
    version: "0",
    tools: [tool(ping, { title: "Ping", idempotent: true, openWorld: false })],
  });
  disposers.unshift(handler.dispose);
  return handler;
};

const settled = <A>(promise: Promise<A>) =>
  Effect.promise(() =>
    promise.then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    ),
  );

it.effect("toFetchHandler answers a layer error with its view and the request id", () =>
  Effect.gen(function* fetchLayerView() {
    const r = yield* fetchOf(down)("down-1");
    expect(r.status).toBe(503);
    expect(r.body).toEqual(unavailable);
    expect(r.headers.get("x-request-id")).toBe("down-1");
  }),
);

it.effect("toMcpHandler answers a layer error with its view, status kept, and never rejects", () =>
  Effect.gen(function* mcpLayerView() {
    const handler = mcpOf(down);
    const r = yield* mcpPost(handler, { "x-request-id": "down-2" }, mcpInitialize);
    expect(r.status).toBe(503);
    expect(r.headers.get("x-request-id")).toBe("down-2");
    const raw = yield* settled(
      handler(
        webRequest("https://app.example/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(mcpInitialize),
        }),
      ).then((response) => response.json()),
    );
    expect(raw).toEqual({ resolved: true, value: unavailable });
  }),
);

it.effect("call() resolves a layer error to its view, never a rejection", () =>
  Effect.gen(function* callLayerView() {
    const outcome = yield* settled(call(down, ping, {}, incoming("down-3")));
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved || outcome.value.ok) return expect.unreachable();
    expect(outcome.value.error).toBeInstanceOf(DbUnavailable);
    expect(outcome.value.view).toMatchObject({ status: 503, body: unavailable });
  }),
);

it.effect("a dying layer is the fixed 500 on every adapter, and nothing rejects", () =>
  Effect.gen(function* dyingLayer() {
    const r = yield* fetchOf(dying)("dead-1");
    expect(r.status).toBe(500);
    expect(r.body).toEqual(internal);
    expect(r.headers.get("x-request-id")).toBe("dead-1");
    const m = yield* mcpPost(mcpOf(dying), { "x-request-id": "dead-2" }, mcpInitialize);
    expect(m.status).toBe(500);
    expect(m.headers.get("x-request-id")).toBe("dead-2");
    const outcome = yield* settled(call(dying, ping, {}, incoming("dead-3")));
    expect(outcome).toMatchObject({
      resolved: true,
      value: { ok: false, error: undefined, view: { status: 500, body: internal } },
    });
  }),
);

it.effect("a failed build is not kept: the next request builds the layer again", () =>
  Effect.gen(function* rebuilds() {
    const { layer, builds } = flaky(1);
    const app = composition({ layer, caller: nobody, views: layerViews });
    disposers.push(app.dispose);
    const get = fetchOf(app);
    const first = yield* get("again-1");
    expect(first.status).toBe(503);
    const second = yield* get("again-2");
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ pong: true });
    const third = yield* get("again-3");
    expect(third.status).toBe(200);
    expect(builds.count).toBe(2);
  }),
);

it.effect("call() and MCP rebuild after a failed build too", () =>
  Effect.gen(function* rebuildsEverywhere() {
    const viaCall = flaky(1);
    const app = composition({ layer: viaCall.layer, caller: nobody, views: layerViews });
    disposers.push(app.dispose);
    const first = yield* Effect.promise(() => call(app, ping, {}, incoming("c-1")));
    const second = yield* Effect.promise(() => call(app, ping, {}, incoming("c-2")));
    expect([first.ok, second.ok]).toEqual([false, true]);
    const viaMcp = flaky(1);
    const mcpApp = composition({ layer: viaMcp.layer, caller: nobody, views: layerViews });
    disposers.push(mcpApp.dispose);
    const handler = mcpOf(mcpApp);
    const refused = yield* mcpPost(handler, {}, mcpInitialize);
    const admitted = yield* mcpPost(handler, {}, mcpInitialize);
    expect([refused.status, admitted.status]).toEqual([503, 200]);
  }),
);

it("a layer error tag without a view is a type error at composition", () => {
  const made = () =>
    // @ts-expect-error DbUnavailable has no view.
    composition({ layer: flaky(1).layer, caller: nobody });
  const wrong = () =>
    // @ts-expect-error The DbUnavailable view takes another error.
    composition({
      layer: flaky(1).layer,
      caller: nobody,
      views: {
        DbUnavailable: (error: { readonly _tag: "Other" }) => ({ status: 503, body: error }),
      },
    });
  expect([typeof made, typeof wrong]).toEqual(["function", "function"]);
});

it("an adapter view may answer a layer error the composition already views", () => {
  const handler = toFetchHandler(down, {
    routes: [route(ping, "GET /ping")],
    views: {
      DbUnavailable: problemView(503, "down", (_error: DbUnavailable) => "Down."),
    },
  });
  disposers.unshift(handler.dispose);
  expect(typeof handler).toBe("function");
});
