import { Clock, Effect } from "effect";

export const atTesting = <A, E, R>(millis: number, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    return yield* effect.pipe(
      Effect.provideService(Clock.Clock, {
        currentTimeMillis: Effect.succeed(millis),
        currentTimeMillisUnsafe: () => millis,
        currentTimeNanos: clock.currentTimeNanos,
        currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
      }),
    );
  });
