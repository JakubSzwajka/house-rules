import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation, errorKind, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { call, endpoint, toFetchHandler } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { bindFixture } from "./execution-fixtures.ts";
import { bothFixture } from "./router-fixtures.ts";
import { mcpInitialize, mcpPost } from "./delivery-mcp-client.ts";
class DbUnavailable extends Schema.TaggedError<DbUnavailable>()("DbUnavailable", {
  kind: errorKind("unavailable"),
}) {
  override get message(): string {
    return "Try again shortly.";
  }
}
const ping = bindFixture(
  featureFixture(
    defineOperation("ping", {
      description: "Answer pong.",
      input: NoInput,
      output: Schema.Struct({ pong: Schema.Boolean }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  () => Effect.succeed({ pong: true }),
);
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
const make = (extra: Layer.Layer<never, DbUnavailable>) =>
  bothFixture([ping], { endpoints: [endpoint(ping, "GET /ping")], extra });
const down = make(flaky(Infinity).layer);
const dying = make(Layer.effectDiscard(Effect.die("a bug")));
const disposers: Array<() => Promise<void>> = [down.dispose, dying.dispose];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const incoming = (id: string) => ({
  headers: new Headers({ "x-request-id": id }),
  url: "https://app.example/",
});
const get = (fixture: ReturnType<typeof make>, id: string) =>
  answer(
    fixture.handler,
    webRequest("https://app.example/ping", { headers: { "x-request-id": id } }),
  );
const mcp = (fixture: ReturnType<typeof make>, id: string) =>
  mcpPost(fixture.handler, { authorization: "Bearer fixture", "x-request-id": id }, mcpInitialize);
const settled = <A>(promise: Promise<A>) =>
  Effect.promise(() =>
    promise.then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    ),
  );
it.effect("HTTP kind-maps a layer failure and echoes the request id", () =>
  Effect.gen(function* () {
    const result = yield* get(down, "down-1");
    expect(result.status).toBe(503);
    expect(result.body).toEqual(unavailable);
    expect(result.headers.get("x-request-id")).toBe("down-1");
  }),
);
it.effect("MCP kind-maps a layer failure with its status and never rejects", () =>
  Effect.gen(function* () {
    const result = yield* mcp(down, "down-2");
    expect(result.status).toBe(503);
    expect(result.headers.get("x-request-id")).toBe("down-2");
    const raw = yield* settled(
      down
        .handler(
          webRequest("https://app.example/mcp", {
            method: "POST",
            headers: {
              authorization: "Bearer fixture",
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(mcpInitialize),
          }),
        )
        .then((response) => response.json()),
    );
    expect(raw).toEqual({ resolved: true, value: unavailable });
  }),
);
it.effect("call resolves a layer failure to its kind view without rejecting", () =>
  Effect.gen(function* () {
    const result = yield* settled(call(down.app, ping, {}, incoming("down-3"), { way: "web" }));
    expect(result.resolved).toBe(true);
    if (!result.resolved || result.value.ok) return expect.unreachable();
    expect(result.value.error).toBeInstanceOf(DbUnavailable);
    expect(result.value.view).toMatchObject({ status: 503, body: unavailable });
  }),
);
it.effect("a dying layer gives the fixed 500 on every way and on call", () =>
  Effect.gen(function* () {
    const http = yield* get(dying, "dead-1");
    expect(http.status).toBe(500);
    expect(http.body).toEqual(internal);
    expect(http.headers.get("x-request-id")).toBe("dead-1");
    const overMcp = yield* mcp(dying, "dead-2");
    expect(overMcp.status).toBe(500);
    expect(overMcp.headers.get("x-request-id")).toBe("dead-2");
    expect(
      yield* settled(call(dying.app, ping, {}, incoming("dead-3"), { way: "web" })),
    ).toMatchObject({
      resolved: true,
      value: { ok: false, error: undefined, view: { status: 500, body: internal } },
    });
  }),
);
it.effect("a failed build is retried while a successful build is kept", () =>
  Effect.gen(function* () {
    const { layer, builds } = flaky(1);
    const fixture = make(layer);
    disposers.push(fixture.dispose);
    expect((yield* get(fixture, "again-1")).status).toBe(503);
    const second = yield* get(fixture, "again-2");
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ pong: true });
    expect((yield* get(fixture, "again-3")).status).toBe(200);
    expect(builds.count).toBe(2);
  }),
);
it.effect("call and MCP both retry a failed app build", () =>
  Effect.gen(function* () {
    const viaCall = make(flaky(1).layer);
    const viaMcp = make(flaky(1).layer);
    disposers.push(viaCall.dispose, viaMcp.dispose);
    const first = yield* Effect.promise(() =>
      call(viaCall.app, ping, {}, incoming("c-1"), { way: "web" }),
    );
    const second = yield* Effect.promise(() =>
      call(viaCall.app, ping, {}, incoming("c-2"), { way: "web" }),
    );
    expect([first.ok, second.ok]).toEqual([false, true]);
    expect([(yield* mcp(viaMcp, "m-1")).status, (yield* mcp(viaMcp, "m-2")).status]).toEqual([
      503, 200,
    ]);
  }),
);
it("a kinded layer error requires no app views table", () => {
  const fixture = make(flaky(1).layer);
  disposers.push(fixture.dispose);
  expect(fixture.app._tag).toBe("Composition");
  expect("views" in fixture.app).toBe(false);
});
it("a fetch handler accepts no second error-view source", () => {
  const invalid = () => {
    // @ts-expect-error Wording belongs to ways, not an adapter views table.
    return toFetchHandler(down.app, { views: { DbUnavailable: () => ({ status: 500 }) } });
  };
  expect(typeof invalid).toBe("function");
});
