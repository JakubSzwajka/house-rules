import { CurrentUnit, UnitOfWork } from "@house-rules/domain";
import { EventSource } from "@house-rules/application";
import { Clock, Context, Effect, Layer, Queue } from "effect";
import { EventLog } from "../../index.js";

export const observedSourceTesting = Effect.fn("observedSourceTesting")(function* (kind: string) {
  const unit = yield* UnitOfWork;
  const clock = yield* Clock.Clock;
  const successes = yield* Queue.unbounded<void>();
  const failures = yield* Queue.unbounded<void>();
  const deadLetters =
    yield* Queue.unbounded<Effect.Success<ReturnType<EventLog["Service"]["listDeadLetters"]>>>();
  const committed = Context.Reference<Array<Effect.Effect<unknown>>>(`test/event-commit/${kind}`, {
    defaultValue: () => [],
  });
  const observedUnit: UnitOfWork["Service"] = {
    atomic: (work) =>
      Effect.gen(function* () {
        if ((yield* CurrentUnit) !== undefined) return yield* unit.atomic(work);
        const signals: Array<Effect.Effect<unknown>> = [];
        const result = yield* unit.atomic(work.pipe(Effect.provideService(committed, signals)));
        // Release latches only after COMMIT makes the observed state visible.
        yield* Effect.all(signals);
        return result;
      }),
  };
  const afterCommit = (signal: Effect.Effect<unknown>) =>
    Effect.flatMap(committed, (signals) => Effect.sync(() => void signals.push(signal)));
  const layer = Layer.effect(
    EventSource,
    Effect.gen(function* () {
      const source = yield* EventSource;
      const log = yield* EventLog;
      return {
        ...source,
        claimDue: (consumer: string) =>
          source.claimDue(consumer).pipe(
            // The driver's authority allowlist intentionally omits Clock.
            Effect.provideService(Clock.Clock, clock),
            Effect.tap(() =>
              log.listDeadLetters({ consumer }).pipe(
                Effect.orDie,
                Effect.flatMap((rows) =>
                  rows.length === 0 ? Effect.void : afterCommit(Queue.offer(deadLetters, rows)),
                ),
              ),
            ),
          ),
        settleSuccess: (token: unknown) =>
          source
            .settleSuccess(token)
            .pipe(Effect.tap(() => afterCommit(Queue.offer(successes, undefined)))),
        settleFailure: (token: unknown, summary: string) =>
          source
            .settleFailure(token, summary)
            .pipe(Effect.tap(() => afterCommit(Queue.offer(failures, undefined)))),
      };
    }),
  );
  return { layer, unit: observedUnit, clock, successes, failures, deadLetters };
});
