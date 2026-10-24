import { expect, it } from "@effect/vitest";
import { defineOperation, memoryUnitOfWork } from "@house-rules/domain";
import { Context, Deferred, Effect, Layer, Schema, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import { McpSchema } from "effect/ai";
import {
  bindOperation,
  CallChannel,
  CallerContext,
  CallRequestId,
  composition,
  CurrentActor,
  defineFeature,
  defineWay,
  EventInput,
  EventSource,
  May,
  Mean,
  StepTrace,
  systemStart,
} from "../index.ts";
import {
  assertAmbientTesting,
  inspectAmbientTesting,
  withAmbientTesting,
} from "./ambient-context.ts";
import { testActor } from "./execution-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";
import { waitTesting as wait } from "./event-way-fixtures.ts";

it.effect("event features and operations have no request or ambient context", () =>
  Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const inspect = (stage: string) =>
      Effect.gen(function* () {
        const context = yield* Effect.context();
        const observation = {
          stage,
          ambient: yield* inspectAmbientTesting,
          request: Context.getOrUndefined(context, HttpServerRequest.HttpServerRequest),
          mcp: Context.getOrUndefined(context, McpSchema.McpRequestContext),
          actor: Context.getOrUndefined(context, CurrentActor),
          caller: Context.getOrUndefined(context, CallerContext),
          channel: yield* CallChannel,
          id: yield* CallRequestId,
        };
        return observation;
      });
    const observations: Array<Effect.Success<ReturnType<typeof inspect>>> = [];
    const record = (stage: string) =>
      inspect(stage).pipe(
        Effect.tap((observation) => Effect.sync(() => observations.push(observation))),
      );
    const operation = defineOperation("inspect_event", {
      description: "Inspect event context.",
      input: EventInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    });
    const feature = defineFeature("isolated_event", {
      ...operation,
      start: systemStart("event isolation"),
      edges: [operation],
      handler: (input, { call }) => record("feature").pipe(Effect.andThen(call(operation, input))),
    });
    const service = Context.Reference<undefined>("test/event-isolation", {
      defaultValue: () => undefined,
    });
    let claimed = false;
    const app = composition({
      modules: {
        mounts: [
          {
            service,
            operations: [operation],
            layer: Layer.empty,
            bind: () => [
              bindOperation(operation, () =>
                record("operation").pipe(
                  Effect.andThen(Deferred.succeed(done, undefined)),
                  Effect.asVoid,
                ),
              ),
            ],
          },
        ],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.succeed(EventSource, {
            consumers: [{ name: "isolated-event", kinds: ["changed"] }],
            claimDue: () =>
              Effect.sync(() => {
                if (claimed) return [];
                claimed = true;
                return ["token"];
              }),
            takeNext: () =>
              Effect.succeed({
                id: "1",
                kind: "changed",
                subject: { kind: "task", id: "1" },
                payload: {},
                scopeId: null,
                actorId: "author",
                occurredAt: 0,
                requestId: "old",
              }),
            settleSuccess: () => Effect.succeed(true),
            settleFailure: () => Effect.succeed(true),
            wake: Stream.never,
          }),
          Layer.effectContext(withAmbientTesting(Effect.context())).pipe(
            Layer.provideMerge(
              Layer.succeedContext(
                Context.make(CurrentActor, testActor).pipe(
                  Context.add(
                    HttpServerRequest.HttpServerRequest,
                    HttpServerRequest.fromWeb(
                      webRequest("https://example.test/?token=private", {
                        headers: { authorization: "Bearer private" },
                      }),
                    ),
                  ),
                  Context.add(McpSchema.McpRequestContext, {
                    clientId: 1,
                    protocolVersion: "2025-11-25",
                    clientCapabilities: {},
                  }),
                ),
              ),
            ),
          ),
        ),
      },
      features: [feature],
      ways: [
        defineWay({
          protocol: "event",
          name: "isolated-event",
          on: ["changed"],
          feature,
          mean: Mean.no,
        }),
      ],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    yield* Effect.gen(function* () {
      yield* app.runtime.contextEffect;
      yield* wait(Deferred.await(done));
      expect(observations.map((o) => o.stage)).toEqual(["feature", "operation"]);
      for (const observation of observations) {
        assertAmbientTesting(observation.ambient);
        expect(observation.request).toBeUndefined();
        expect(observation.mcp).toBeUndefined();
        expect(observation.actor).toBeUndefined();
        expect(observation.caller?.kind).toBe("system");
        expect(observation.channel).toBe("event:isolated-event");
        expect(observation.id).toEqual(expect.any(String));
        expect(observation.id).not.toBe("old");
      }
      expect(observations[0]?.id).toBe(observations[1]?.id);
    }).pipe(Effect.ensuring(Effect.promise(() => app.dispose())));
  }),
);
