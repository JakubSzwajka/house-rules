import { expect, layer } from "@effect/vitest";
import {
  Actor,
  ActorId,
  defineOperation,
  errorKind,
  type Permission,
  UnitOfWork,
} from "@house-rules/domain";
import {
  bindOperation,
  CallRequestId,
  composition,
  CurrentActor,
  defineFeature,
  defineWay,
  endpoint,
  EventInput,
  May,
  Mean,
  runFeature,
  StepTrace,
  systemStart,
} from "@house-rules/application";
import { Clock, Context, Effect, Layer, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpServerRequest } from "effect/http";
import { EventLog, EventLogMount, EventLogOperations, EventStore } from "../../index.js";
import { stores } from "./stores.js";
import { observedSourceTesting } from "./event-way-source.js";

const actor = Actor.make({ id: ActorId.make("event-author") });
class Rejected extends Schema.TaggedError<Rejected>()("Rejected", {
  kind: errorKind("conflict"),
}) {}
import { PoisonTesting as Poison, observeEventTesting } from "./event-way-context.js";

for (const { name, layer: world } of stores) {
  layer(world, { timeout: "30 seconds" })(`Event ways on ${name}`, (it) => {
    const setup = Effect.fn("setup")(function* (
      kind: string,
      reject = false,
      system: readonly Permission[] = ["reactions:write"],
    ) {
      const store = yield* EventStore;
      const {
        layer: observedSource,
        unit,
        clock,
        successes,
        failures,
        deadLetters,
      } = yield* observedSourceTesting(kind);
      const observations: Array<
        Effect.Success<typeof observeEventTesting> & { causedBy: string | null }
      > = [];
      let tries = 0;
      const writes: string[] = [];
      const reaction = defineOperation(`reaction_${kind}`, {
        description: "Inspect system reaction.",
        input: EventInput,
        output: Schema.Void,
        failure: Rejected,
        permission: "reactions:write",
        transactional: true,
      });
      const feature = defineFeature(`handle_${kind}`, {
        description: "Handle one event as the system.",
        input: EventInput,
        output: Schema.Void,
        failure: Rejected,
        permission: null,
        start: systemStart("react to recorded fact", `event:${kind}`),
        edges: [reaction],
        handler: (input, { call }) => call(reaction, input),
      });
      const producer = defineFeature(`produce_${kind}`, {
        description: "Record an event as a person.",
        input: EventLogOperations.record.input,
        output: EventLogOperations.record.output,
        failure: EventLogOperations.record.failure,
        permission: null,
        edges: [EventLogOperations.record],
        handler: (input, { call }) => call(EventLogOperations.record, input),
      });
      const service = Context.Reference<undefined>(`test/event-way/${kind}`, {
        defaultValue: () => undefined,
      });
      const logLayer = observedSource.pipe(
        Layer.provide(EventLog.source),
        Layer.provideMerge(
          EventLog.layer({
            registry: { [kind]: Schema.Struct({ text: Schema.String }) },
            consumers: [
              { name: kind, kinds: [kind], maxAttempts: 2, backoff: { baseMs: 10, capMs: 10 } },
            ],
          }),
        ),
        Layer.provide(Layer.succeed(EventStore, store)),
      );
      const trace = StepTrace.make();
      const app = composition({
        modules: {
          mounts: [
            { ...EventLogMount, layer: logLayer },
            {
              service,
              operations: [reaction],
              layer: Layer.empty,
              bind: () => [
                bindOperation(reaction, (input, { caller }) =>
                  Effect.gen(function* () {
                    yield* UnitOfWork.required;
                    expect(caller.kind).toBe("system");
                    observations.push({
                      ...(yield* observeEventTesting),
                      causedBy: input.causedBy,
                    });
                    expect(input.event.actorId).toBe(input.causedBy);
                    tries++;
                    yield* UnitOfWork.onRollback(
                      Effect.sync(() => {
                        writes.pop();
                      }),
                    );
                    writes.push(input.event.id);
                    if (reject) return yield* new Rejected();
                  }),
                ),
              ],
            },
          ],
          layer: Layer.mergeAll(
            Layer.succeed(UnitOfWork, unit),
            Layer.succeed(Clock.Clock, clock),
            Layer.succeed(StepTrace, trace),
            Layer.succeed(CurrentActor, actor),
            Layer.succeed(Poison, "private"),
            Layer.succeed(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request("https://example.test/?token=private") as Parameters<
                  typeof HttpServerRequest.fromWeb
                >[0],
              ),
            ),
          ),
        },
        features: [producer, feature],
        ways: [
          defineWay({ protocol: "event", name: kind, on: [kind], feature, mean: Mean.no }),
          defineWay({
            protocol: "http",
            name: `web_${kind}`,
            path: "/",
            features: [producer],
            endpoints: [endpoint(producer)],
            who: { resolve: () => Effect.succeed(actor) },
            mean: Mean.no,
          }),
        ],
        may: Effect.succeed({
          permissionsOf: () => Effect.die("Event drivers must not load the author's permissions"),
        }),
        system,
        eventSweepMs: 1000,
      });
      yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
      const context = yield* app.runtime.contextEffect;
      const log = Context.get(context, EventLog);
      const produce = runFeature(producer, {
        kind,
        subject: { kind: "task", id: "task-1" },
        payload: { text: "changed" },
        scopeId: null,
      }).pipe(
        Effect.provideContext(context),
        Effect.provideContext(
          May.context(May.fixed(["event-log:record", "reactions:write"]), {
            features: [producer],
            system: [],
            via: "person-test",
          }),
        ),
        Effect.provideService(CurrentActor, actor),
        Effect.provideService(CallRequestId, "producer-request"),
      );
      const wait = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.raceFirst(
          effect,
          TestClock.withLive(Effect.never.pipe(Effect.timeout("2 seconds"))),
        );
      const exhaust = Effect.gen(function* () {
        yield* wait(Queue.take(failures));
        yield* wait(TestClock.adjust(1000));
        yield* wait(Queue.take(failures));
        yield* wait(TestClock.adjust(1000));
      });
      const dead = (count: number) =>
        wait(
          Queue.take(deadLetters).pipe(Effect.repeat({ until: (rows) => rows.length === count })),
        );
      return {
        log,
        produce,
        wait,
        successes,
        exhaust,
        dead,
        observations,
        writes,
        trace,
        tries: () => tries,
      };
    });
    it.effect(
      "a person records an event; its system reaction has causation but no person authority",
      () =>
        Effect.gen(function* () {
          const f = yield* setup(`success_${name}`);
          {
            const event = yield* f.produce;
            yield* f.wait(Queue.take(f.successes));
            expect(yield* f.log.due()).toEqual([]);
            expect(event.actorId).toBe(actor.id);
            expect(f.tries()).toBe(1);
            expect(f.writes).toEqual([event.id]);
            expect(f.observations).toHaveLength(1);
            const observation = f.observations[0];
            expect(observation).toMatchObject({
              causedBy: actor.id,
              caller: "system",
              actor: false,
              channel: `event:success_${name}`,
              poisoned: false,
              network: false,
            });
            expect(observation?.id).not.toBe("producer-request");
            expect(observation?.id).toEqual(expect.any(String));
            expect(observation?.annotations).not.toHaveProperty("authorization");
            expect(observation?.spanName).toBe(`event:success_${name}`);
            expect(observation?.parent).toMatchObject({ _tag: "None" });
            const steps = yield* f.trace.read(observation?.id ?? null);
            expect(steps.steps).toMatchObject([
              { caller: "system", causedBy: actor.id, outcome: "success" },
            ]);
          }
        }),
    );
    it.effect("causedBy cannot grant the author's permissions when the system has none", () =>
      Effect.gen(function* () {
        const f = yield* setup(`forbidden_${name}`, false, []);
        {
          const event = yield* f.produce;
          yield* f.exhaust;
          const dead = yield* f.dead(1);
          expect(dead).toMatchObject([{ eventId: event.id, attempts: 2 }]);
          expect(f.tries()).toBe(0);
          expect(f.writes).toEqual([]);
        }
      }),
    );
    it.effect(
      "failed delivery rolls back writes, retries and dead-letters without stopping the loop",
      () =>
        Effect.gen(function* () {
          const f = yield* setup(`failure_${name}`, true);
          {
            const event = yield* f.produce;
            yield* f.exhaust;
            const dead = yield* f.dead(1);
            expect(f.tries()).toBe(2);
            expect(f.writes).toEqual([]);
            expect(dead).toMatchObject([
              {
                eventId: event.id,
                attempts: 2,
                lastError: "Delivery failed. See internal logs.",
              },
            ]);
            expect(new Set(f.observations.map((o) => o.id)).size).toBe(2);
            expect(
              f.observations.every(
                (o) => !o.actor && o.caller === "system" && o.causedBy === actor.id,
              ),
            ).toBe(true);
            // A dead letter must not hold the next event behind the cursor.
            const second = yield* f.produce;
            yield* f.exhaust;
            const both = yield* f.dead(2);
            expect(both.map((row) => row.eventId)).toEqual([event.id, second.id]);
            expect(f.tries()).toBe(4);
          }
        }),
    );
  });
}
