import { Effect, Layer, Semaphore } from "effect";
import { makeUnitOfWork, UnitOfWork } from "../unit-of-work/unit-of-work.ts";

export const memoryUnitOfWork: Layer.Layer<UnitOfWork> = Layer.effect(
  UnitOfWork,
  Effect.gen(function* memoryUnitOfWork() {
    // No row locks here: interleaved units could let one unit's rollback undo another's commit.
    const oneAtATime = yield* Semaphore.make(1);
    return makeUnitOfWork(
      (effect) => effect,
      (effect) => oneAtATime.withPermit(effect),
    );
  }),
);
