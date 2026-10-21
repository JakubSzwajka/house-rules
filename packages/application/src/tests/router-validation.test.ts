import { featureFixture } from "./feature-fixtures.ts";
import { expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  admit,
  call,
  composition,
  defineApi,
  defineWay,
  endpoint,
  May,
  Mean,
  toFetchHandler,
} from "../index.ts";
import { bindFixture, fixtureLayer, testActor } from "./execution-fixtures.ts";
import { bothFixture, httpFixture } from "./router-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";
const options = {
  description: "Read.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  permission: null,
  readOnly: true,
} as const;
it.effect("nested way prefixes do not hide another way's concrete endpoint", () =>
  Effect.gen(function* () {
    const root = bindFixture(featureFixture(defineOperation("root", options)), () =>
      Effect.succeed("root"),
    );
    const child = bindFixture(featureFixture(defineOperation("child", options)), () =>
      Effect.succeed("child"),
    );
    const features = [root, child] as const;
    const who = { resolve: () => Effect.succeed(testActor) };
    const first = defineWay({
      name: "root",
      path: "/",
      protocol: "http",
      features: [root],
      endpoints: [endpoint(root, "GET /api/root")],
      who,
      may: May.fixed([root], []),
      mean: Mean.no,
    });
    const second = defineWay({
      name: "child",
      path: "/api",
      protocol: "http",
      features: [child],
      endpoints: [endpoint(child, "GET /child")],
      who,
      may: May.fixed([child], []),
      mean: Mean.no,
    });
    const app = composition({
      layer: fixtureLayer(features),
      features: features,
      ways: [first, second],
      system: [],
    });
    const handler = toFetchHandler(app);
    for (const [path, expected] of [
      ["/api/root", "root"],
      ["/api/child", "child"],
    ]) {
      const response = yield* Effect.promise(() =>
        handler(webRequest(`https://app.example${path}`)),
      );
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toBe(expected);
    }
    yield* Effect.promise(() => handler.dispose().then(app.dispose));
  }),
);
it.effect("invalid status, unsafe path and repeated path keys fail typed acquisition", () =>
  Effect.gen(function* () {
    const feature = bindFixture(
      featureFixture(
        defineOperation("read", { ...options, input: Schema.Struct({ id: Schema.String }) }),
      ),
      () => Effect.succeed("ok"),
    );
    for (const shape of [
      endpoint(feature, "GET /read", { status: 500 }),
      endpoint(feature, "GET /a//b"),
      endpoint(feature, "GET /:id/:id"),
    ]) {
      const fixture = httpFixture([feature], { endpoints: [shape] });
      const result = yield* Effect.promise(() =>
        admit(fixture.app, { headers: new Headers(), url: "/" }, { way: "web" }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "GraphInvalid", kind: "unavailable" },
      });
      yield* Effect.promise(fixture.dispose);
    }
  }),
);
it.effect("HTTP cannot occupy the MCP route owned by the same router", () =>
  Effect.gen(function* () {
    const feature = bindFixture(featureFixture(defineOperation("read", options)), () =>
      Effect.succeed("ok"),
    );
    const fixture = bothFixture([feature], { endpoints: [endpoint(feature, "GET /mcp")] });
    const result = yield* Effect.promise(() =>
      admit(fixture.app, { headers: new Headers(), url: "/" }, { way: "web" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "GraphInvalid", reason: expect.stringMatching(/MCP/u) },
    });
    yield* Effect.promise(fixture.dispose);
  }),
);

it.effect(
  "an admitted actor cannot be reused on another named way, even for the same feature",
  () =>
    Effect.gen(function* () {
      let callers = 0;
      let callables = 0;
      const feature = bindFixture(featureFixture(defineOperation("shared", options)), () =>
        Effect.sync(() => {
          callables += 1;
          return "ok";
        }),
      );
      const fixture = bothFixture([feature], {
        endpoints: [endpoint(feature)],
        who: {
          resolve: () =>
            Effect.sync(() => {
              callers += 1;
              return testActor;
            }),
        },
      });
      const incoming = { headers: new Headers({ "x-request-id": "same-app-wrong-way" }), url: "/" };
      const admitted = yield* Effect.promise(() => admit(fixture.app, incoming, { way: "web" }));
      if (!admitted.ok) return expect.unreachable();
      const outcome = yield* Effect.promise(() =>
        call(fixture.app, feature, {}, incoming, { way: "mcp", admitted: admitted.value }),
      );
      expect(outcome).toMatchObject({
        ok: false,
        view: { status: 500, body: { error: { code: "internal_error" } } },
      });
      expect([callers, callables]).toEqual([1, 0]);
      yield* Effect.promise(fixture.dispose);
    }),
);

it.effect("a dotted API prefix and a 202 success share one prefix owner", () =>
  Effect.gen(function* () {
    const feature = bindFixture(featureFixture(defineOperation("accepted", options)), () =>
      Effect.succeed("ok"),
    );
    const api = defineApi(
      { prefix: "/v1.2" },
      { read: endpoint(feature, "GET /read", { status: 202 }) },
    );
    const fixture = httpFixture([feature], {
      path: "/v1.2",
      endpoints: Object.values(api.endpoints),
    });
    const response = yield* Effect.promise(() =>
      fixture.handler(webRequest("https://app.example/v1.2/read")),
    );
    expect(response.status).toBe(202);
    expect(yield* Effect.promise(() => response.json())).toBe("ok");
    yield* Effect.promise(fixture.dispose);
  }),
);
