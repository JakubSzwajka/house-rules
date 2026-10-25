import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type WorkItem, WorkItemStore } from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const record = (id: string, containerId = "page", createdAt = 100): WorkItem => ({
  id,
  title: id,
  body: "",
  status: "todo",
  holder: null,
  parent: null,
  container: { kind: "project", id: containerId },
  attributes: {},
  createdAt,
  updatedAt: createdAt,
  closedAt: null,
});
const visible = { containers: [{ kind: "project", id: "page" }], inbox: false };
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `WorkItemStore on ${name}`,
    (it) => {
      it.effect(
        "orders equal timestamps by id and applies exclusive cursors after visibility",
        () =>
          Effect.gen(function* () {
            const store = yield* WorkItemStore;
            yield* UnitOfWork.atomic(
              Effect.forEach(
                [record("z", "page", 101), record("b"), record("a"), record("hidden", "secret")],
                (item) => store.insert(item),
              ),
            );
            expect((yield* store.list(visible, { size: 2 })).map((item) => item.id)).toEqual([
              "a",
              "b",
            ]);
            expect(
              (yield* store.list(visible, { size: 10, cursor: { createdAt: 100, id: "b" } })).map(
                (item) => item.id,
              ),
            ).toEqual(["z"]);
            expect(yield* store.list(visible, { cursor: { createdAt: 101, id: "z" } })).toEqual([]);
            expect(yield* store.list({ containers: [], inbox: false }, {})).toEqual([]);
            const returned = yield* store.get("a");
            if (returned !== null) {
              const attributes = returned.attributes;
              expect(attributes).toEqual({});
            }
          }),
      );
      it.effect("uses a conditional claim even without a preceding row lock", () =>
        Effect.gen(function* () {
          const store = yield* WorkItemStore;
          const item = record("conditional", "race");
          yield* UnitOfWork.atomic(store.insert(item));
          const outcomes = yield* Effect.forEach(
            ["first", "second"],
            (id) =>
              UnitOfWork.atomic(
                store.claim({ ...item, status: "doing", holder: { kind: "person", id } }),
              ),
            { concurrency: "unbounded" },
          );
          expect(outcomes.filter(Boolean)).toHaveLength(1);
          expect(outcomes.filter((won) => !won)).toHaveLength(1);
        }),
      );
      it.effect("conditionally claims the current holder but rejects a different kind or id", () =>
        Effect.gen(function* () {
          const store = yield* WorkItemStore;
          const item = {
            ...record("assigned-conditional"),
            holder: { kind: "agent", id: "x" },
          };
          yield* UnitOfWork.atomic(store.insert(item));
          for (const holder of [
            { kind: "agent", id: "other" },
            { kind: "person", id: "x" },
          ]) {
            expect(yield* UnitOfWork.atomic(store.claim({ ...item, holder }))).toBe(false);
            expect(yield* store.get(item.id)).toEqual(item);
          }
          const claimed = { ...item, status: "doing" };
          expect(yield* UnitOfWork.atomic(store.claim(claimed))).toBe(true);
          expect(yield* store.get(item.id)).toEqual(claimed);
        }),
      );
      it.effect("requires units for every mutation and rolls back insertion", () =>
        Effect.gen(function* () {
          const store = yield* WorkItemStore;
          const item = record("outside");
          expect(yield* Effect.flip(store.lock("missing"))).toBeInstanceOf(NoOpenUnit);
          for (const write of [
            store.insert(item),
            store.save(item),
            store.claim(item).pipe(Effect.asVoid),
            store.removeContainer({ kind: "project", id: "page" }),
            store.releaseHolder({ kind: "person", id: "a" }, 1),
          ])
            expect(yield* Effect.flip(write)).toBeInstanceOf(NoOpenUnit);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.insert(record("rollback"));
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.get("rollback")).toBeNull();
        }),
      );
    },
  );
