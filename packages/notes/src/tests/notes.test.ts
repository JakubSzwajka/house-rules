import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { Notes, NoteTargets, NoteTargetNotFound, NoteInputInvalid } from "../index.js";
const actor = Actor.make({ id: ActorId.make("author") });
let calls = 0;
const targets = Layer.succeed(
  NoteTargets,
  NoteTargets.of({
    relation: (_actor, ref) =>
      Effect.sync(() => {
        calls++;
        return ref.id === "missing" ? "none" : "member";
      }),
  }),
);
const world = Notes.layerMemory({ targets: ["booking"], maxBodyLength: 10, maxPageSize: 2 }).pipe(
  Layer.provide(targets),
  Layer.provideMerge(memoryUnitOfWork),
);
it.layer(world)("Notes", (test) => {
  test.effect("validates target kind before host access and hides inaccessible targets", () =>
    Effect.gen(function* () {
      const notes = yield* Notes;
      const start = calls;
      expect(
        yield* Effect.flip(notes.list(actor, { kind: "other", id: "x" }, { size: 1 })),
      ).toBeInstanceOf(NoteInputInvalid);
      expect(calls).toBe(start);
      expect(
        yield* Effect.flip(notes.list(actor, { kind: "booking", id: "missing" }, { size: 1 })),
      ).toBeInstanceOf(NoteTargetNotFound);
    }),
  );
  test.effect("adds immutable notes and returns an exclusive oldest-first cursor", () =>
    Effect.gen(function* () {
      const notes = yield* Notes;
      const target = { kind: "booking", id: "one" };
      const first = yield* UnitOfWork.atomic(notes.add(actor, target, "first"));
      yield* UnitOfWork.atomic(notes.add(actor, target, "second"));
      expect(first).toMatchObject({ target, authorId: actor.id, body: "first" });
      const page = yield* notes.list(actor, target, { size: 1 });
      expect(page.notes).toHaveLength(1);
      expect(page.next).toBeDefined();
      if (!page.next) return yield* Effect.die("Expected cursor");
      const second = yield* notes.list(actor, target, { size: 10, cursor: page.next });
      expect(second.notes).toHaveLength(1);
      expect(second.notes[0]?.id).not.toBe(page.notes[0]?.id);
      expect(
        yield* Effect.flip(notes.add(actor, target, "01234567890").pipe(UnitOfWork.atomic)),
      ).toBeInstanceOf(NoteInputInvalid);
      expect(yield* Effect.flip(notes.add(actor, target, "no unit"))).toBeInstanceOf(NoOpenUnit);
    }),
  );
});
