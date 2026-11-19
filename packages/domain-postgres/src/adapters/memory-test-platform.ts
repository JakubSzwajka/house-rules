import * as InMemory from "@alchemy.run/domain/InMemory";
import { Platform } from "@alchemy.run/domain/Platform";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const memoryTestPlatform = Layer.unwrap(
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const now = () => clock.currentTimeMillisUnsafe();
    const scheduleClock = (at: number): Clock.Clock => ({
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanos: clock.monotonicTimeNanos,
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      // Alchemy beta.85 checks the deadline once after sleep; an early wake loses the timer.
      sleep: () =>
        Effect.gen(function* () {
          let remaining = at - now();
          while (remaining > 0) {
            yield* clock.sleep(Duration.millis(Math.ceil(remaining)));
            remaining = at - now();
          }
        }),
    });
    return Layer.effect(
      Platform,
      Effect.gen(function* () {
        const platform = yield* Platform;
        return Platform.of({
          model: (model) =>
            Effect.map(platform.model(model), (host) => ({
              ...host,
              aggregate: (aggregate, kit) =>
                Effect.map(host.aggregate(aggregate, kit), (store) => ({
                  ...store,
                  schedule: (id, command, meta, due) =>
                    Effect.suspend(() => {
                      const at = "at" in due ? due.at : now() + due.afterMillis;
                      return store
                        .schedule(id, command, meta, { at })
                        .pipe(Effect.provideService(Clock.Clock, scheduleClock(at)));
                    }),
                })),
            })),
        });
      }),
    ).pipe(Layer.provide(InMemory.make({ now }).layer));
  }),
);
