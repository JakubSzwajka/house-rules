import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Comment, CommentStore } from "../../index.js";
import { stores } from "./stores.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const record = (id: string, targetId = id, authorId = "a", createdAt = 100): Comment => ({
  id,
  target: { kind: "booking", id: targetId },
  authorId,
  body: "plain text",
  createdAt,
});

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `CommentStore on ${name}`,
    (it) => {
      it.effect("adds, finds and edits without changing creation facts", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          const first = record("edit");
          expect(yield* store.find(first.id)).toBeUndefined();
          yield* UnitOfWork.atomic(store.insert(first));
          expect(yield* store.find(first.id)).toEqual(first);
          expect(yield* UnitOfWork.atomic(store.edit(first.id, "new body", 200))).toEqual({
            ...first,
            body: "new body",
            editedAt: 200,
          });
          expect(yield* store.find(first.id)).toEqual({
            ...first,
            body: "new body",
            editedAt: 200,
          });
          expect(yield* UnitOfWork.atomic(store.edit("missing", "new body", 200))).toBeUndefined();
        }),
      );
      it.effect("lists by createdAt then id, with an exclusive cursor and target isolation", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("page-z", "page", "a", 101),
                record("page-b", "page"),
                record("page-a", "page"),
                record("other-page"),
                { ...record("kind-page", "page"), target: { kind: "other", id: "page" } },
              ],
              (comment) => store.insert(comment),
            ),
          );
          const ref = { kind: "booking", id: "page" };
          const first = yield* store.list(ref, { size: 1 });
          expect(first.map((row) => row.id)).toEqual(["page-a"]);
          const second = yield* store.list(ref, {
            size: 2,
            after: { createdAt: 100, id: "page-a" },
          });
          expect(second.map((row) => row.id)).toEqual(["page-b", "page-z"]);
          expect(
            yield* store.list(ref, { size: 5, after: { createdAt: 101, id: "page-z" } }),
          ).toEqual([]);
        }),
      );
      it.effect("hard-deletes one id and removes only the matching target kind and id", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          const other = {
            ...record("remove-other", "remove"),
            target: { kind: "other", id: "remove" },
          };
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("remove-one", "remove"),
                record("remove-two", "remove"),
                record("keep-target"),
                other,
              ],
              (comment) => store.insert(comment),
            ),
          );
          yield* UnitOfWork.atomic(store.remove("remove-one"));
          expect(yield* store.find("remove-one")).toBeUndefined();
          expect(yield* store.find("remove-two")).toBeDefined();
          yield* UnitOfWork.atomic(store.removeTarget({ kind: "booking", id: "remove" }));
          expect(yield* store.find("remove-two")).toBeUndefined();
          expect(yield* store.find("keep-target")).toBeDefined();
          expect(yield* store.find(other.id)).toEqual(other);
        }),
      );
      it.effect("erases one author across targets and leaves other authors", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("erase-one", "one", "erase-author"),
                record("erase-two", "two", "erase-author"),
                record("keep-author", "one", "other-author"),
              ],
              (comment) => store.insert(comment),
            ),
          );
          yield* UnitOfWork.atomic(store.erase("erase-author"));
          expect(yield* store.find("erase-one")).toBeUndefined();
          expect(yield* store.find("erase-two")).toBeUndefined();
          expect(yield* store.find("keep-author")).toBeDefined();
        }),
      );
      it.effect("every write requires an open unit", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          const calls = [
            store.insert(record("outside")),
            store.edit("outside", "changed", 200),
            store.remove("outside"),
            store.removeTarget({ kind: "booking", id: "outside" }),
            store.erase("a"),
          ];
          for (const call of calls) expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find("outside")).toBeUndefined();
        }),
      );
      it.effect("rolls back insert, edit, remove, removeTarget and erase together", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          const initial = [
            record("rollback-edit"),
            record("rollback-remove"),
            record("rollback-target", "rollback-target"),
            record("rollback-author", "other", "rollback-author"),
          ];
          yield* UnitOfWork.atomic(Effect.forEach(initial, (comment) => store.insert(comment)));
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* store.insert(record("rollback-insert"));
                yield* store.edit("rollback-edit", "changed", 200);
                yield* store.remove("rollback-remove");
                yield* store.removeTarget({ kind: "booking", id: "rollback-target" });
                yield* store.erase("rollback-author");
                return yield* new Rollback();
              }),
            ),
          );
          expect(error).toBeInstanceOf(Rollback);
          expect(yield* store.find("rollback-insert")).toBeUndefined();
          for (const comment of initial) expect(yield* store.find(comment.id)).toEqual(comment);
        }),
      );
      it.effect("reads return independent data", () =>
        Effect.gen(function* () {
          const store = yield* CommentStore;
          const first = record("copy");
          yield* UnitOfWork.atomic(store.insert(first));
          const found = yield* store.find(first.id);
          expect(found).toEqual(first);
          expect(found).not.toBe(first);
          expect(found?.target).not.toBe(first.target);
        }),
      );
    },
  );
}
