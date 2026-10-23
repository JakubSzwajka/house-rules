import type { Permission } from "@house-rules/domain";
import { Cause, Clock, Context, Cron, Effect, Layer, Option, Result } from "effect";
import { newRequestId, withRequestId } from "../call/request-id.ts";
import { runFeature } from "../execution/run-feature.ts";
import { CallInvalid } from "../runtime/call-invalid.ts";
import { GraphInvalid } from "../runtime/graph-invalid.ts";
import type { GatePolicy } from "../socket/permission-lists.ts";
import { systemExecutionContext } from "./execution-context.ts";
import type { SystemFeature } from "./way.ts";
import type { AnyWay } from "./way-validation.ts";

export const systemWays = (
  ways: readonly AnyWay<any>[],
  system: readonly Permission[],
  gatePolicy: GatePolicy,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (!ways.some((way) => way.protocol === "hook" || way.protocol === "schedule"))
        return Layer.empty;
      let slots = Context.empty() as Context.Context<any>;
      const keys = new Set<string>();
      const available = yield* Effect.context<never>();
      const schedules: Array<Effect.Effect<void, GraphInvalid, import("effect").Scope.Scope>> = [];
      for (const way of ways) {
        if (way.protocol !== "hook" && way.protocol !== "schedule") continue;
        const captured = yield* systemExecutionContext(way, system, gatePolicy);
        const execute = (feature: SystemFeature, input: SystemFeature["input"]["Type"]) =>
          Effect.gen(function* () {
            const id = yield* newRequestId;
            return yield* withRequestId(runFeature(feature, input), id).pipe(
              Effect.annotateLogs({ way: way.name, requestId: id }),
              Effect.withSpan(`${way.protocol}:${way.name}`, { root: true }),
            );
          }).pipe(Effect.setContext(captured));
        if (way.protocol === "hook") {
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
