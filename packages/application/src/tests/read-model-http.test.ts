import { expect, it } from "@effect/vitest";
import { Actor, ActorId, defineOperation, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import { webRequest } from "./delivery-fixtures.ts";
import {
  bindOperation,
  call,
  CallWatch,
  composition,
  CurrentActor,
  defineFeature,
  defineReadModel,
  defineWay,
  endpoint,
  Mean,
  Refused,
  StepTrace,
  toFetchHandler,
} from "../index.ts";

it.effect("HTTP query and command share admission, schemas, May, audit, trace and units", () =>
  Effect.gen(function* () {
    const actor = Actor.make({ id: ActorId.make("ada") });
    const seen: string[] = [];
    let count = 0;
    let checks = 0;
    const base = {
      description: "Counter",
      input: Schema.Struct({ n: Schema.Int }),
      output: Schema.Int,
      failure: Schema.Never,
    } as const;
    const read = defineOperation("Counter.read", {
      ...base,
      readOnly: true,
      permission: "counter:read",
    });
    const write = defineOperation("Counter.write", {
      ...base,
      transactional: true,
      permission: "counter:write",
    });
    const query = defineReadModel("query", {
      ...base,
      permission: null,
      edges: [read],
      handler: (input, { call }) => call(read, input),
    });
    const command = defineFeature("command", {
      ...base,
      permission: null,
      edges: [write],
      handler: (input, { call }) => call(write, input),
    });
    const hidden = defineReadModel("hidden", {
      ...base,
      permission: null,
      handler: () => Effect.succeed(99),
    });
    const service = Context.Reference<undefined>("test/counter", { defaultValue: () => undefined });
    const trace = StepTrace.make();
    const way = defineWay({
      name: "web",
      protocol: "http",
      path: "/",
      features: [query, command],
      endpoints: [endpoint(query, "GET /count"), endpoint(command, "POST /count")],
      mean: Mean.no,
      who: {
        resolve: (incoming) =>
          incoming.headers.has("authorization")
            ? Effect.succeed(actor)
            : Effect.fail(new Refused({ status: 401, code: "unauthorized", message: "Sign in." })),
      },
    });
    const app = composition({
      features: [query, command, hidden],
      ways: [way],
      system: [],
      may: Effect.succeed({
        permissionsOf: () => {
          checks++;
          return Effect.succeed(["counter:read", "counter:write"] as const);
        },
      }),
      modules: {
        mounts: [
          {
            service,
            operations: [read, write],
            layer: Layer.empty,
            bind: () => [
              bindOperation(read, ({ n }, scope) =>
                Effect.gen(function* () {
                  expect(scope.caller).toMatchObject({ kind: "person", actor });
                  expect(Context.getOrUndefined(yield* Effect.context(), CurrentActor)).toEqual(
                    actor,
                  );
                  return count + n;
                }),
              ),
              bindOperation(write, ({ n }) =>
                Effect.gen(function* () {
                  yield* UnitOfWork.required;
                  count += n;
                  return count;
                }),
              ),
            ],
          },
        ],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          Layer.succeed(StepTrace, trace),
          Layer.succeed(CallWatch, {
            around: (entry, _input, run) => {
              seen.push(entry.kind);
              return run;
            },
          }),
        ),
      },
    });
    const router = toFetchHandler(app);
    try {
      const request = (url: string, init?: RequestInit) =>
        Effect.promise(() => router(webRequest(`https://app.example${url}`, init)));
      const headers = { authorization: "Bearer test", "content-type": "application/json" };
      expect((yield* request("/count?n=1")).status).toBe(401);
      expect((yield* request("/count?n=bad", { headers })).status).toBe(400);
      const written = yield* request("/count", { method: "POST", headers, body: '{"n":3}' });
      expect(written.status).toBe(200);
      expect(yield* Effect.promise(() => written.json())).toBe(3);
      const readBack = yield* request("/count?n=2", { headers });
      expect(readBack.status).toBe(200);
      expect(yield* Effect.promise(() => readBack.json())).toBe(5);
      expect(checks).toBe(2);
      expect(seen).toEqual(["feature", "read-model"]);
      expect(
        (yield* trace.read(readBack.headers.get("x-request-id") ?? "")).steps[0],
      ).toMatchObject({ feature: "query", target: "Counter.read", outcome: "success" });
      const denied = yield* Effect.promise(() =>
        call(
          app,
          hidden,
          { n: 1 },
          { headers: new Headers(headers), url: "https://app.example/count" },
          { way: "web" },
        ),
      );
      expect(denied).toMatchObject({ ok: false, error: { _tag: "CallInvalid" } });
    } finally {
      yield* Effect.promise(() => router.dispose().then(() => app.dispose()));
    }
  }),
);
