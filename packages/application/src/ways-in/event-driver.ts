import { type KindedError, UnitOfWork } from "@house-rules/domain";
import { Cause, type Context, Effect, Schedule, Stream, type Fiber, type Scope } from "effect";
import { EventCausation } from "../call/event-causation.ts";
import { newRequestId, withRequestId } from "../call/request-id.ts";
import { runFeature } from "../execution/run-feature.ts";
import { EventSource, EventSourceUnavailable } from "./event-source.ts";
import type { EventWay } from "./way.ts";

export const eventDriver: (
  way: EventWay,
  source: EventSource["Service"],
  captured: Context.Context<any>,
  sweepMs: number,
) => Effect.Effect<Fiber.Fiber<never, EventSourceUnavailable | KindedError>, never, Scope.Scope> = (
  way: EventWay,
  source: EventSource["Service"],
  captured: Context.Context<any>,
  sweepMs: number,
) => {
  const logFailure = <E>(cause: Cause.Cause<E>) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.logError(`Event way ${way.name} failed`, cause);
  const deliver = (token: unknown) =>
    Effect.gen(function* () {
      const id = yield* newRequestId;
      const work = UnitOfWork.atomic(
        Effect.gen(function* () {
          const event = yield* source.takeNext(token);
          if (event === null) return;
          // Keep the open unit and SQL transaction context through runFeature.
          yield* runFeature(way.feature, { event, causedBy: event.actorId }).pipe(
            Effect.provideService(EventCausation, event.actorId),
          );
          if (!(yield* source.settleSuccess(token)))
            return yield* Effect.die("Event delivery settlement lost its token");
        }),
      );
      yield* withRequestId(work, id).pipe(
        Effect.annotateLogs({ way: way.name, requestId: id }),
        Effect.withSpan(`event:${way.name}`, { root: true }),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* logFailure(cause);
            // The failed delivery unit has rolled back before failure bookkeeping.
            yield* UnitOfWork.atomic(
              source.settleFailure(token, "Delivery failed. See internal logs."),
            ).pipe(Effect.catchCause(logFailure));
          }),
        ),
      );
    });
  const drain = Effect.gen(function* () {
    while (true) {
      // Commit the attempt before opening the handler unit.
      const tokens = yield* UnitOfWork.atomic(source.claimDue(way.name));
      if (tokens.length === 0) return;
      for (const token of tokens) yield* deliver(token);
    }
  }).pipe(Effect.catchCause(logFailure), Effect.setContext(captured));
  const signals = Stream.merge(
    source.wake,
    Stream.fromEffectSchedule(Effect.void, Schedule.spaced(sweepMs)),
  );
  // Restart failed LISTEN streams; polling remains the safety net for missed wakes.
  return Effect.forever(
    signals.pipe(
      Stream.runForEach(() => drain),
      Effect.catchCause((cause) => logFailure(cause).pipe(Effect.andThen(Effect.sleep(sweepMs)))),
    ),
  ).pipe(Effect.forkScoped);
};
