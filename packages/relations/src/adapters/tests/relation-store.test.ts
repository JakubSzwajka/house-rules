import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Relation, RelationStore } from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const node = (id: string) => ({ kind: "item", id });
const edge = (
  id: string,
  source: string,
  target: string,
  type = "link",
  createdAt = 100,
): Relation => ({
  id,
  type,
  source: node(source),
  target: node(target),
  createdAt,
});
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `RelationStore on ${name}`,
    (it) => {
      it.effect("stores opaque endpoints, counts directions, and pages exclusively", () =>
        Effect.gen(function* () {
          const store = yield* RelationStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                edge("page-b", "page", "b"),
                edge("page-a", "a", "page"),
                edge("page-c", "page", "c", "other", 101),
                edge("page-self", "page", "page", "self"),
              ],
              store.insert,
            ),
          );
          expect((yield* store.list(node("page"), undefined, "both", 2)).map((e) => e.id)).toEqual([
            "page-a",
            "page-b",
          ]);
          expect(
            (yield* store.list(node("page"), undefined, "both", 10, {
              createdAt: 100,
              id: "page-b",
            })).map((e) => e.id),
          ).toEqual(["page-self", "page-c"]);
          expect(yield* store.count(node("page"), "link", "out")).toBe(1);
          expect(yield* store.count(node("page"), "link", "in")).toBe(1);
          expect(yield* store.count(node("page"), "link", "both")).toBe(2);
          expect(yield* store.count(node("page"), "self", "both")).toBe(1);
          expect(yield* store.exists(node("page"), node("b"), "link")).toBe(true);
          expect(yield* store.exists(node("b"), node("page"), "link")).toBe(false);
          expect(yield* store.list({ kind: "other", id: "page" }, undefined, "both", 10)).toEqual(
            [],
          );
        }),
      );
      it.effect("walks directed reachability with deduplication and a bound", () =>
        Effect.gen(function* () {
          const store = yield* RelationStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                edge("walk-1", "walk-a", "walk-b"),
                edge("walk-2", "walk-b", "walk-c"),
                edge("walk-3", "walk-c", "walk-a"),
                edge("walk-4", "walk-a", "walk-b"),
                edge("walk-other", "walk-c", "walk-d", "other"),
              ],
              store.insert,
            ),
          );
          expect(
            (yield* store.reachable(node("walk-a"), "link", 10)).map((n) => n.id).sort(),
          ).toEqual(["walk-a", "walk-b", "walk-c"]);
          expect(yield* store.reachable(node("walk-a"), "link", 2)).toHaveLength(2);
        }),
      );
      it.effect("requires open units on every write", () =>
        Effect.gen(function* () {
          const store = yield* RelationStore;
          for (const write of [
            store.lock("link"),
            store.insert(edge("outside", "x", "y")),
            store.remove("outside"),
            store.removeNode(node("x")),
          ])
            expect(yield* Effect.flip(write)).toBeInstanceOf(NoOpenUnit);
        }),
      );
      it.effect("rolls back inserts, deletes and all-type node cascades", () =>
        Effect.gen(function* () {
          const store = yield* RelationStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                edge("cascade-out", "cascade", "out"),
                edge("cascade-in", "in", "cascade", "other"),
                edge("cascade-keep", "keep", "other"),
              ],
              store.insert,
            ),
          );
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.removeNode(node("cascade"));
                  yield* store.remove("cascade-keep");
                  yield* store.insert(edge("rolled-back", "cascade", "new"));
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.list(node("cascade"), undefined, "both", 10)).toHaveLength(2);
          expect(yield* store.list(node("keep"), undefined, "both", 10)).toHaveLength(1);
          yield* UnitOfWork.atomic(store.removeNode(node("cascade")));
          yield* UnitOfWork.atomic(store.removeNode(node("cascade")));
          expect(yield* store.list(node("cascade"), undefined, "both", 10)).toEqual([]);
          expect(yield* UnitOfWork.atomic(store.remove("cascade-keep"))).toEqual(
            edge("cascade-keep", "keep", "other"),
          );
          expect(yield* UnitOfWork.atomic(store.remove("cascade-keep"))).toBeUndefined();
        }),
      );
      it.effect("returns copies that cannot mutate stored endpoints", () =>
        Effect.gen(function* () {
          const store = yield* RelationStore;
          const original = edge("copy", "copy", "copy-target");
          yield* UnitOfWork.atomic(store.insert(original));
          Object.assign(original.source, { id: "changed" });
          const result = yield* store.list(node("copy"), undefined, "both", 10);
          const first = result[0];
          expect(first?.source.id).toBe("copy");
          if (first !== undefined) Object.assign(first.source, { id: "changed-again" });
          expect((yield* store.list(node("copy"), undefined, "both", 10))[0]?.source.id).toBe(
            "copy",
          );
        }),
      );
    },
  );
