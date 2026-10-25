import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Caller, type Permission } from "@house-rules/domain";
import { Effect, Layer, Option, Schema } from "effect";
import {
  type Around,
  type WayOptions,
  CallWatch,
  CurrentActor,
  Runtime,
  StepTrace,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  Refused,
  systemStart,
  toFetchHandler,
  toOpenApi,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";

expectTypeOf<Extract<WayOptions, { protocol: "mcp" }>["public"]>().toEqualTypeOf<undefined>();

const start = systemStart("public sign in", "web");
const publicFeature = defineFeature("public_start", {
  description: "Start without a person.",
  input: Schema.Struct({}),
  output: Schema.String,
  failure: Schema.Never,
  permission: "sessions:issue",
  start,
  handler: (_input, { caller }) => Effect.succeed(JSON.stringify(caller)),
});
const privateFeature = defineFeature("private_start", {
  description: "Start as a person.",
  input: Schema.Struct({}),
  output: Schema.String,
  failure: Schema.Never,
  permission: null,
  handler: () => Effect.succeed("private"),
});
const features = [publicFeature, privateFeature];
const make = (system: readonly Permission[]) => {
  let whoCalls = 0;
  const rows: Array<{ caller: Caller | "person"; person: boolean }> = [];
  const way = defineWay({
    name: "web",
    path: "/",
    protocol: "http",
    features,
    public: [publicFeature],
    endpoints: features.map((feature) => endpoint(feature)),
    who: {
      resolve: (incoming) => {
        whoCalls += 1;
        if (incoming.headers.get("authorization") === "Bearer valid-token")
          return Effect.succeed(testActor);
        return Effect.fail(new Refused({ status: 401, code: "missing", message: "Sign in." }));
      },
    },
    mean: Mean.no,
  });
  const watch = Layer.succeed(CallWatch, {
    around: ((feature, _input, run) =>
      Effect.gen(function* () {
        const person = yield* Effect.serviceOption(CurrentActor);
        rows.push({ caller: feature.start, person: Option.isSome(person) });
        return yield* run;
      })) satisfies Around,
  });
  const app = composition({
    modules: {
      mounts: [],
      layer: Layer.mergeAll(watch, StepTrace.layer(), Layer.succeed(CurrentActor, testActor)),
    },
    features,
    ways: [way],
    may: Effect.succeed(May.fixed(["sessions:issue"])),
    system,
  });
  const handler = toFetchHandler(app);
  return {
    way,
    handler,
    rows,
    whoCalls: () => whoCalls,
    dispose: () => handler.dispose().then(() => app.dispose()),
  };
};
const request = (name: string, token?: string) =>
  webRequest(`https://app.example/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: "{}",
  });

it.effect(
  "public starts ignore all tokens, never resolve Who, and audit only the system caller",
  () =>
    Effect.gen(function* () {
      const fixture = make(["sessions:issue"]);
      yield* Effect.addFinalizer(() => Effect.promise(fixture.dispose));
      for (const token of [undefined, "garbage", "valid-token"]) {
        const response = yield* Effect.promise(() =>
          fixture.handler(request(publicFeature.name, token)),
        );
        expect(response.status).toBe(200);
        expect(JSON.parse(String(yield* Effect.promise(() => response.json())))).toEqual(start);
      }
      expect(fixture.whoCalls()).toBe(0);
      expect(fixture.rows).toEqual(
        Array.from({ length: 3 }, () => ({ caller: start, person: false })),
      );
      const denied = yield* Effect.promise(() => fixture.handler(request(privateFeature.name)));
      expect(denied.status).toBe(401);
      expect(fixture.whoCalls()).toBe(1);
    }),
);

it.effect("public permissions come only from system, and a refusal is audited once", () =>
  Effect.gen(function* () {
    const fixture = make([]);
    yield* Effect.addFinalizer(() => Effect.promise(fixture.dispose));
    const response = yield* Effect.promise(() => fixture.handler(request(publicFeature.name)));
    expect(response.status).toBe(403);
    expect(fixture.whoCalls()).toBe(0);
    expect(fixture.rows).toEqual([{ caller: start, person: false }]);
  }),
);

it.effect(
  "acquisition refuses person public starts, unexposed public starts and MCP public lists",
  () =>
    Effect.gen(function* () {
      for (const way of [
        { name: "bad", features, public: [privateFeature] },
        { name: "bad", features: [privateFeature], public: [publicFeature] },
        { name: "bad", features, protocol: "mcp" as const, public: [publicFeature] },
      ]) {
        const failure = yield* Effect.flip(Runtime.make({ bindings: [], features, ways: [way] }));
        expect(failure._tag).toBe("GraphInvalid");
      }
    }),
);

it.effect("OpenAPI marks only public routes despite global authentication", () =>
  Effect.sync(() => {
    const document = toOpenApi(
      features.map((feature) => endpoint(feature)),
      {
        title: "test",
        version: "1",
        public: [publicFeature],
        security: { schemes: { bearer: { type: "http", scheme: "bearer" } } },
      },
    );
    expect(document.paths[`/${publicFeature.name}`]?.post?.security).toEqual([]);
    expect(document.paths[`/${privateFeature.name}`]?.post).not.toHaveProperty("security");
    expect(document.security).toEqual([{ bearer: [] }]);
  }),
);
