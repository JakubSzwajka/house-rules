import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import {
  composition,
  defineFeature,
  defineWay,
  May,
  Mean,
  StepTrace,
  systemStart,
} from "../index.ts";

it.effect("interrupting a slot caller interrupts its isolated hook", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let mapped = false;
    class Slot extends Context.Service<Slot, () => Effect.Effect<never, string>>()(
      "test/isolation/InterruptedSlot",
    ) {}
    const feature = defineFeature("interruptible_hook", {
      description: "Wait for caller interruption.",
      input: Schema.Struct({}),
      output: Schema.Never,
      failure: Schema.Never,
      permission: null,
      start: systemStart("interruption test"),
      flags: { readOnly: true },
      handler: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
    });
    const hook = defineWay({
      name: "interruptible",
      protocol: "hook",
      slot: Slot,
      features: [feature],
      mean: Mean.no,
      input: () => ({}),
      failure: () => {
        mapped = true;
        return "mapped";
      },
    });
    const app = composition({
      modules: { mounts: [], layer: Layer.merge(memoryUnitOfWork, StepTrace.layer()) },
      features: [feature],
      ways: [hook],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    try {
      const context = yield* app.runtime.contextEffect;
      const fiber = yield* Context.get(context, Slot)().pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(yield* Deferred.isDone(interrupted)).toBe(true);
      expect(mapped).toBe(false);
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
