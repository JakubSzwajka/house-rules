import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Project, ProjectStore } from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const record = (id: string, name = id): Project => ({
  id,
  slug: id,
  name,
  status: "active",
  description: "",
  createdAt: 10,
  updatedAt: 10,
});
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `ProjectStore on ${name}`,
    (it) => {
      it.effect("stores, orders, filters and copies records", () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [record("store-z", "Zulu"), record("store-b", "Alpha"), record("store-a", "alpha")],
              store.insert,
            ),
          );
          expect((yield* store.list()).map((p) => p.id)).toEqual(["store-a", "store-b", "store-z"]);
          expect(yield* store.list("archived")).toEqual([]);
          expect((yield* store.list(undefined, ["store-a"])).map((p) => p.id)).toEqual(["store-a"]);
          expect(yield* store.list(undefined, [])).toEqual([]);
          expect(yield* store.get({ slug: "store-a" })).toEqual(record("store-a", "alpha"));
          const found = yield* store.get({ id: "store-a" });
          if (found !== undefined) Object.assign(found, { name: "mutated" });
          expect(yield* store.get({ id: "store-a" })).toEqual(record("store-a", "alpha"));
        }),
      );
      it.effect("enforces slug uniqueness on insert and replace", () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          yield* UnitOfWork.atomic(store.insert(record("taken")));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(store.insert({ ...record("collision"), slug: "taken" })),
            ),
          ).toMatchObject({ _tag: "ProjectSlugTaken" });
          yield* UnitOfWork.atomic(store.insert(record("rename")));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(store.replace({ ...record("rename"), slug: "taken" })),
            ),
          ).toMatchObject({ _tag: "ProjectSlugTaken" });
        }),
      );
      it.effect("requires live units for every write and rolls back insert and update", () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          expect(yield* Effect.flip(store.lock)).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(store.insert(record("outside")))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(store.replace(record("outside")))).toBeInstanceOf(NoOpenUnit);
          yield* UnitOfWork.atomic(store.insert(record("rollback-update")));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.insert(record("rollback-insert"));
                  yield* store.replace({
                    ...record("rollback-update"),
                    slug: "changed",
                    status: "archived",
                  });
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.get({ id: "rollback-insert" })).toBeUndefined();
          expect(yield* store.get({ id: "rollback-update" })).toEqual(record("rollback-update"));
        }),
      );
    },
  );
