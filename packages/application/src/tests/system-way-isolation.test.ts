import { expect, it } from "@effect/vitest";
import { defineOperation, memoryUnitOfWork } from "@house-rules/domain";
import { Clock, Context, Deferred, Effect, Layer, Schema } from "effect";
import { McpSchema } from "effect/ai";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { TestClock } from "effect/testing";
import {
  bindOperation,
  CallChannel,
  CallerContext,
  CallRequestId,
  composition,
  CurrentActor,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  Refused,
  StepTrace,
  systemStart,
  toFetchHandler,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";
import {
  assertAmbientTesting,
  inspectAmbientTesting,
  withAmbientTesting,
} from "./ambient-context.ts";

const credentials = ["authorization", "cookie", "proxy-authorization", "set-cookie"];
const headers = new Headers([
  ["AuThOrIzAtIoN", "Bearer synthetic"],
  ["authorization", "Bearer second"],
  ["CoOkIe", "session=synthetic"],
  ["COOKIE", "other=synthetic"],
  ["pRoXy-AuThOrIzAtIoN", "Basic synthetic"],
  ["SeT-CoOkIe", "hidden=synthetic"],
  ["SET-COOKIE", "second=synthetic"],
  ["x-request-id", "network-request"],
]);
const incoming = { headers, url: "https://app.example/inspect?access_token=synthetic" };
const callerScope = Context.Service<unknown>("@house-rules/application/CallerScope");
const requestBound = Context.make(callerScope, {
  incoming,
  actor: testActor,
  requestId: "outer",
}).pipe(
  Context.add(
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(webRequest(incoming.url, { headers })),
  ),
  Context.add(HttpServerRequest.ParsedSearchParams, { access_token: "synthetic" }),
  Context.add(McpSchema.McpRequestContext, {
    clientId: 1,
    protocolVersion: "2025-11-25",
    clientCapabilities: {},
  }),
  Context.add(McpSchema.McpServerClient, {
    clientId: 1,
    protocolVersion: "2025-11-25",
    clientCapabilities: {},
    clientInfo: { name: "synthetic", version: "1" },
    initializePayload: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "synthetic", version: "1" },
    },
    getClient: Effect.never,
  }),
  Context.add(CurrentActor, testActor),
);
const inspect = (stage: string) =>
  Effect.gen(function* () {
    const context = yield* Effect.context();
    const request = Context.getOrUndefined(context, HttpServerRequest.HttpServerRequest);
    const scope = context.mapUnsafe.get(callerScope.key) as
      | { incoming: typeof incoming }
      | undefined;
    return {
      stage,
      ambient: yield* inspectAmbientTesting,
      request: request !== undefined,
      rawSource: request?.source !== undefined,
      callerScope: scope !== undefined,
      credentials: credentials.filter(
        (name) => request?.headers[name] !== undefined || scope?.incoming.headers.has(name),
      ),
      route: Context.getOrUndefined(context, HttpRouter.RouteContext) !== undefined,
      search: Context.getOrUndefined(context, HttpServerRequest.ParsedSearchParams) !== undefined,
      mcpRequest: Context.getOrUndefined(context, McpSchema.McpRequestContext) !== undefined,
      mcpClient: Context.getOrUndefined(context, McpSchema.McpServerClient) !== undefined,
      actor: Context.getOrUndefined(context, CurrentActor) !== undefined,
      caller: Context.getOrUndefined(context, CallerContext)?.kind,
      channel: yield* CallChannel,
      id: yield* CallRequestId,
    };
  });
type Observation = Effect.Success<ReturnType<typeof inspect>>;
const assertIsolated = (observations: Observation[], channel: string) => {
  for (const observation of observations) {
    assertAmbientTesting(observation.ambient);
    expect(observation).toEqual({
      stage: observation.stage,
      ambient: observation.ambient,
      request: false,
      rawSource: false,
      callerScope: false,
      credentials: [],
      route: false,
      search: false,
      mcpRequest: false,
      mcpClient: false,
      actor: false,
      caller: "system",
      channel,
      id: expect.any(String),
    });
    expect(observation.id).not.toBe("network-request");
    expect(observation.id).not.toBe("outer");
  }
};
const fixtures = (observations: Observation[], done: Deferred.Deferred<void>) => {
  const record = (stage: string) =>
    inspect(stage).pipe(Effect.tap((value) => Effect.sync(() => observations.push(value))));
  const operation = defineOperation("isolated_operation", {
    description: "Inspect system operation context.",
    input: Schema.Struct({}),
    output: Schema.String,
    failure: Schema.Never,
    permission: null,
    readOnly: true,
  });
  const feature = defineFeature("isolated_item", {
    ...operation,
    start: systemStart("isolation test"),
    edges: [operation],
    flags: { readOnly: true },
    handler: (input, { call }) => record("feature").pipe(Effect.andThen(call(operation, input))),
  });
  const selector = defineFeature("isolated_selector", {
    description: "Inspect selector context.",
    input: Schema.Struct({}),
    output: Schema.Array(feature.input),
    failure: Schema.Never,
    permission: null,
    start: systemStart("isolation test"),
    flags: { readOnly: true },
    handler: () => record("selector").pipe(Effect.as([{}])),
  });
  const service = Context.Reference<undefined>("test/isolation", { defaultValue: () => undefined });
  const modules = {
    mounts: [
      {
        service,
        operations: [operation],
        layer: Layer.empty,
        bind: () => [
          bindOperation(operation, () =>
            record("operation").pipe(
              Effect.andThen(Deferred.succeed(done, undefined)),
              Effect.as("checked"),
            ),
          ),
        ],
      },
    ],
    layer: Layer.merge(memoryUnitOfWork, StepTrace.layer()),
  };
  return { feature, selector, modules };
};

it.effect(
  "a hook inside HTTP Who isolates its feature and operation from request and ambient context",
  () =>
    Effect.gen(function* () {
      const observations: Observation[] = [];
      const { feature, modules } = fixtures(observations, yield* Deferred.make<void>());
      class Slot extends Context.Service<Slot, () => Effect.Effect<string, Refused>>()(
        "test/isolation/Slot",
      ) {}
      const hook = defineWay({
        name: "first-sign-in",
        protocol: "hook",
        slot: Slot,
        features: [feature],
        mean: Mean.allow,
        input: () => ({}),
        failure: () => new Refused({ status: 403, code: "refused", message: "Hook refused." }),
      });
      const normal = defineFeature("after_who", {
        description: "Finish admission.",
        input: Schema.Struct({}),
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
        flags: { readOnly: true },
        handler: () => Effect.succeed("admitted"),
      });
      let admitted = 0;
      const web = defineWay({
        name: "web",
        protocol: "http",
        path: "/",
        features: [normal],
        mean: Mean.no,
        endpoints: [endpoint(normal, "GET /inspect")],
        who: {
          resolve: (request) =>
            Effect.gen(function* () {
              for (const name of credentials) expect(request.headers.has(name)).toBe(true);
              expect(
                yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest),
              ).toMatchObject({ _tag: "Some" });
              admitted++;
              yield* withAmbientTesting((yield* Slot)().pipe(Effect.provideContext(requestBound)));
              return testActor;
            }),
        },
      });
      const app = composition({
        modules,
        features: [feature, normal],
        ways: [web, hook],
        may: Effect.succeed(May.fixed([])),
        system: [],
      });
      const handler = toFetchHandler(app);
      try {
        const response = yield* Effect.promise(() =>
          handler(webRequest(incoming.url, { headers })),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).toBe("network-request");
        expect(admitted).toBe(1);
        expect(observations.map((o) => o.stage)).toEqual(["feature", "operation"]);
        assertIsolated(observations, "hook:first-sign-in");
        expect(observations[0]?.id).toBe(observations[1]?.id);
      } finally {
        yield* Effect.promise(() => handler.dispose().then(() => app.dispose()));
      }
    }),
);
it.effect("schedule selectors, items and operations have no request or ambient context", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1767236340000);
    const done = yield* Deferred.make<void>();
    const observations: Observation[] = [];
    const { feature, selector, modules } = fixtures(observations, done);
    const schedule = defineWay({
      name: "isolated-clock",
      protocol: "schedule",
      clock: { cron: "0 3 * * *", timeZone: "UTC" },
      features: [selector, feature],
      mean: Mean.allow,
      input: {},
    });
    const app = composition({
      modules: {
        ...modules,
        layer: Layer.mergeAll(
          modules.layer,
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          Layer.effectContext(withAmbientTesting(Effect.context())).pipe(
            Layer.provideMerge(Layer.succeedContext(requestBound)),
          ),
        ),
      },
      features: [selector, feature],
      ways: [schedule],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    try {
      yield* app.runtime.contextEffect;
      expect(observations).toEqual([]);
      yield* TestClock.adjust("1 minute");
      yield* Deferred.await(done);
      expect(observations.map((o) => o.stage)).toEqual(["selector", "feature", "operation"]);
      assertIsolated(observations, "schedule:isolated-clock");
      expect(observations[0]?.id).not.toBe(observations[1]?.id);
      expect(observations[1]?.id).toBe(observations[2]?.id);
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
