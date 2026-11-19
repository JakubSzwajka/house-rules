import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { memoryTestPlatform } from "../memory-test-platform.ts";
import { Audit, RecordAudit, TalliesLive, TallyId } from "./tally.ts";

const World = TalliesLive.pipe(Layer.provideMerge(memoryTestPlatform));

describe("the memory test platform", () => {
  it.effect.each([100, 100.5])(
    "delivers a %s millisecond schedule after an early wake",
    (closeAfterMillis) =>
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        let earlyWakeAt: number | undefined;
        const earlyClock: Clock.Clock = {
          ...clock,
          sleep: (duration) =>
            Effect.suspend(() => {
              if (earlyWakeAt !== undefined) return clock.sleep(duration);
              earlyWakeAt = clock.currentTimeMillisUnsafe();
              return Effect.void;
            }),
        };
        yield* Effect.gen(function* () {
          const tallies = yield* Audit;
          const id = TallyId.make("early");
          const scheduled = yield* tallies.schedule(id, new RecordAudit(), {
            after: Duration.millis(closeAfterMillis),
            commandId: "early-close",
          });
          yield* TestClock.adjust(0);
          expect(earlyWakeAt).toBe(0);
          expect(earlyWakeAt).toBeLessThan(DateTime.toEpochMillis(scheduled.at));
          expect(yield* tallies.state(id)).toEqual({ count: 0 });
          yield* TestClock.adjust(Math.ceil(closeAfterMillis));
          expect(yield* tallies.state(id)).toEqual({ count: 1 });
        }).pipe(Effect.provide(World), Effect.provideService(Clock.Clock, earlyClock));
      }).pipe(Effect.scoped),
  );

  it.effect("keeps the deadline when the clock moves backward after upstream reads now", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(900);
      const clock = yield* Clock.Clock;
      let offset = 0;
      let moveBackward = false;
      let upstreamRead: number | undefined;
      const now = () => {
        const read = clock.currentTimeMillisUnsafe() + offset;
        if (moveBackward) {
          moveBackward = false;
          upstreamRead = read;
          offset = -100;
        }
        return read;
      };
      const shiftedClock: Clock.Clock = { ...clock, currentTimeMillisUnsafe: now };
      yield* Effect.gen(function* () {
        const tallies = yield* Audit;
        const id = TallyId.make("backward");
        moveBackward = true;
        const scheduled = yield* tallies.schedule(id, new RecordAudit(), {
          at: DateTime.makeUnsafe(1_000),
          commandId: "backward-close",
        });
        yield* TestClock.adjust(0);
        expect(upstreamRead).toBe(900);
        expect(now()).toBe(800);
        expect(DateTime.toEpochMillis(scheduled.at)).toBe(1_000);
        yield* TestClock.adjust(100);
        expect(now()).toBe(900);
        expect(yield* tallies.state(id)).toEqual({ count: 0 });
        yield* TestClock.adjust(100);
        expect(now()).toBe(1_000);
        expect(yield* tallies.state(id)).toEqual({ count: 1 });
      }).pipe(Effect.provide(World), Effect.provideService(Clock.Clock, shiftedClock));
    }).pipe(Effect.scoped),
  );
});
