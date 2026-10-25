import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { WorkItems } from "../../index.js";
import { a, access } from "./access.js";
import { stores } from "./stores.js";

const options = {
  ...WorkItems.presets.board,
  states: [...WorkItems.presets.board.states, { name: "verified", category: "done" }],
  transitions: { ...WorkItems.presets.board.transitions, verified: "any" },
} as const;

for (const { name, layer: storeLayer } of stores) {
  const world = WorkItems.layer(options).pipe(
    Layer.provide(access),
    Layer.provideMerge(storeLayer),
  );
  layer(world, { timeout: "30 seconds" })(`WorkItems closedAt on ${name}`, (it) => {
    it.effect("starts a new interval when cancelled changes to done", () =>
      Effect.gen(function* () {
        const work = yield* WorkItems;
        yield* TestClock.setTime(1000);
        const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "cancelled then done" }));
        const cancelled = yield* UnitOfWork.atomic(work.setStatus(a, item.id, "dropped"));
        expect(cancelled.item.closedAt).toBe(1000);
        yield* TestClock.setTime(2000);
        const done = yield* UnitOfWork.atomic(work.setStatus(a, item.id, "done"));
        expect(done.item.closedAt).toBe(2000);
        expect((yield* work.get(a, item.id)).closedAt).toBe(2000);
      }),
    );
    it.effect("keeps the interval when changing to a sibling in the done category", () =>
      Effect.gen(function* () {
        const work = yield* WorkItems;
        yield* TestClock.setTime(3000);
        const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "done then verified" }));
        yield* UnitOfWork.atomic(work.setStatus(a, item.id, "done"));
        yield* TestClock.setTime(4000);
        const verified = yield* UnitOfWork.atomic(work.setStatus(a, item.id, "verified"));
        expect(verified.item).toMatchObject({ closedAt: 3000, updatedAt: 4000 });
        expect((yield* work.get(a, item.id)).closedAt).toBe(3000);
      }),
    );
    it.effect("clears the interval on reopen and starts a new one on closing again", () =>
      Effect.gen(function* () {
        const work = yield* WorkItems;
        yield* TestClock.setTime(5000);
        const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "done then reopened" }));
        yield* UnitOfWork.atomic(work.setStatus(a, item.id, "done"));
        yield* TestClock.setTime(6000);
        const reopened = yield* UnitOfWork.atomic(work.setStatus(a, item.id, "todo"));
        expect(reopened.item.closedAt).toBeNull();
        expect((yield* work.get(a, item.id)).closedAt).toBeNull();
        yield* TestClock.setTime(7000);
        const done = yield* UnitOfWork.atomic(work.setStatus(a, item.id, "done"));
        expect(done.item.closedAt).toBe(7000);
        expect((yield* work.get(a, item.id)).closedAt).toBe(7000);
      }),
    );
  });
}
