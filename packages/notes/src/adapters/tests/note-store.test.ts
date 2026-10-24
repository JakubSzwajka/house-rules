import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Note, NoteStore } from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const record = (id: string, targetId = id, authorId = "a", createdAt = 100): Note => ({
  id,
  target: { kind: "booking", id: targetId },
  authorId,
  body: "plain text",
  createdAt,
});
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `NoteStore on ${name}`,
    (it) => {
      it.effect("appends, orders and pages notes exclusively", () =>
        Effect.gen(function* () {
          const store = yield* NoteStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("z", "page", "a", 101),
                record("b", "page"),
                record("a", "page"),
                record("other"),
              ],
              (note) => store.insert(note),
            ),
          );
          const ref = { kind: "booking", id: "page" };
          expect((yield* store.list(ref, { size: 2 })).map((x) => x.id)).toEqual(["a", "b"]);
          expect(
            (yield* store.list(ref, { size: 3, after: { createdAt: 100, id: "b" } })).map(
              (x) => x.id,
            ),
          ).toEqual(["z"]);
          expect(yield* store.list(ref, { size: 3, after: { createdAt: 101, id: "z" } })).toEqual(
            [],
          );
        }),
      );
      it.effect("supports only account and target cascades", () =>
        Effect.gen(function* () {
          const store = yield* NoteStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [record("target", "x"), record("author", "y", "erase"), record("keep")],
              (x) => store.insert(x),
            ),
          );
          yield* UnitOfWork.atomic(store.removeTarget({ kind: "booking", id: "x" }));
          yield* UnitOfWork.atomic(store.erase("erase"));
          expect(yield* store.list({ kind: "booking", id: "x" }, { size: 10 })).toEqual([]);
          expect(yield* store.list({ kind: "booking", id: "y" }, { size: 10 })).toEqual([]);
          expect(
            (yield* store.list({ kind: "booking", id: "keep" }, { size: 10 })).map((x) => x.id),
          ).toEqual(["keep"]);
        }),
      );
      it.effect("requires units for all writes and rolls back cascades and inserts", () =>
        Effect.gen(function* () {
          const store = yield* NoteStore;
          expect(yield* Effect.flip(store.insert(record("outside")))).toBeInstanceOf(NoOpenUnit);
          expect(
            yield* Effect.flip(store.removeTarget({ kind: "booking", id: "outside" })),
          ).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(store.erase("outside"))).toBeInstanceOf(NoOpenUnit);
          const failure = yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* store.insert(record("rollback"));
                return yield* new Rollback();
              }),
            ),
          );
          expect(failure).toBeInstanceOf(Rollback);
          expect(yield* store.list({ kind: "booking", id: "rollback" }, { size: 1 })).toEqual([]);
        }),
      );
    },
  );
