import type { Permission } from "@house-rules/domain";
import { Cause, Clock, Context, Cron, Effect, Layer, Option, Result } from "effect";
import { newRequestId, withRequestId } from "../call/request-id.ts";
import { runFeature } from "../execution/run-feature.ts";
import { CallInvalid } from "../runtime/call-invalid.ts";
import { GraphInvalid } from "../runtime/graph-invalid.ts";
import { systemExecutionContext } from "./execution-context.ts";
import type { SystemFeature } from "./way.ts";
import type { AnyWay } from "./way-validation.ts";
import { EventSource } from "./event-source.ts";
import { eventDriver } from "./event-driver.ts";

export const systemWays = (
  ways: readonly AnyWay<any>[],
  system: readonly Permission[],
  sweepMs = 30000,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (
        !ways.some(
          (way) =>
            way.protocol === "hook" || way.protocol === "schedule" || way.protocol === "event",
        )
      )
        return Layer.empty;
      let slots = Context.empty() as Context.Context<any>;
      const keys = new Set<string>();
      const available = yield* Effect.context<never>();
      const schedules: Array<Effect.Effect<void, GraphInvalid, import("effect").Scope.Scope>> = [];
      const consumers = new Set<string>();
      if (!Number.isSafeInteger(sweepMs) || sweepMs <= 0)
        return yield* new GraphInvalid({ reason: "Invalid event sweep interval" });
      for (const way of ways) {
        if (way.protocol !== "hook" && way.protocol !== "schedule" && way.protocol !== "event")
          continue;
        const captured = yield* systemExecutionContext(way, system);
        const execute = (feature: SystemFeature, input: SystemFeature["input"]["Type"]) =>
          Effect.gen(function* () {
            const id = yield* newRequestId;
            return yield* withRequestId(runFeature(feature, input), id).pipe(
              Effect.annotateLogs({ way: way.name, requestId: id }),
              Effect.withSpan(`${way.protocol}:${way.name}`, { root: true }),
            );
          }).pipe(Effect.setContext(captured));
        if (way.protocol === "event") {
          const source = yield* Effect.serviceOption(EventSource);
          if (Option.isNone(source))
            return yield* new GraphInvalid({ reason: `Missing EventSource for ${way.name}` });
          if (consumers.has(way.name))
            return yield* new GraphInvalid({ reason: `Duplicate event consumer ${way.name}` });
          consumers.add(way.name);
          const registration = source.value.consumers.find((entry) => entry.name === way.name);
          const missing = way.on.filter((kind) => !registration?.kinds.includes(kind));
          const extra = registration?.kinds.filter((kind) => !way.on.includes(kind)) ?? [];
          if (registration === undefined || missing.length > 0 || extra.length > 0)
            return yield* new GraphInvalid({
              reason: `Event consumer ${way.name} kinds mismatch: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
            });
          schedules.push(eventDriver(way, source.value, captured, sweepMs).pipe(Effect.asVoid));
        } else if (way.protocol === "hook") {
          if (keys.has(way.slot.key) || Option.isSome(Context.getOption(available, way.slot)))
            return yield* new GraphInvalid({ reason: `Duplicate hook slot ${way.slot.key}` });
          keys.add(way.slot.key);
          const feature = way.features[0];
          slots = Context.add(slots, way.slot, (event: unknown) =>
            Effect.suspend(() => execute(feature, way.input(event))).pipe(
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
                const error = Cause.findErrorOption(cause);
                return Effect.logError(`Hook ${way.name} failed`, cause).pipe(
                  Effect.andThen(
                    Effect.fail(
                      way.failure(
                        (Option.isSome(error)
                          ? error.value
                          : new CallInvalid({
                              callable: feature.name,
                              reason: "Hook execution failed",
                            })) as never,
                      ),
                    ),
                  ),
                );
              }),
              Effect.setContext(captured),
            ),
          );
        } else if (way.protocol === "schedule") {
          const parsed = Cron.parse(way.clock.cron, way.clock.timeZone);
          if (Result.isFailure(parsed) || way.clock.timeZone !== "UTC")
            return yield* new GraphInvalid({ reason: `Invalid UTC schedule clock ${way.name}` });
          const nextDate = Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            return yield* Effect.try({
              try: () => Cron.next(parsed.success, now),
              catch: () =>
                new GraphInvalid({ reason: `Schedule clock has no next date ${way.name}` }),
            });
          });
          yield* nextDate;
          const [selector, item] = way.features;
          const tick = Effect.gen(function* () {
            const inputs = yield* execute(selector, way.input);
            if (!Array.isArray(inputs))
              return yield* Effect.die("Schedule selector must return an array");
            for (const input of inputs) {
              yield* execute(item, input as SystemFeature["input"]["Type"]).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.failCause(cause)
                    : Effect.logError(`Schedule ${way.name} item failed`, cause),
                ),
              );
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logError(`Schedule ${way.name} selector failed`, cause),
            ),
            Effect.setContext(captured),
          );
          schedules.push(
            Effect.gen(function* () {
              let nextTick = yield* nextDate;
              yield* Effect.logInfo(`Schedule ${way.name} armed for next tick`, {
                ...way.clock,
                nextTick: nextTick.toISOString(),
              });
              yield* Effect.forever(
                Effect.gen(function* () {
                  yield* Effect.sleep(
                    Math.max(0, nextTick.getTime() - (yield* Clock.currentTimeMillis)),
                  );
                  yield* tick;
                  nextTick = yield* nextDate;
                }),
              ).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.failCause(cause)
                    : Effect.logError(`Schedule ${way.name} stopped`, cause),
                ),
                Effect.forkScoped,
              );
            }),
          );
        }
      }
      // Validate every slot and clock before any driver starts.
      return Layer.succeedContext(slots).pipe(
        Layer.tap(() => Effect.forEach(schedules, (start) => start)),
      );
    }),
  );
