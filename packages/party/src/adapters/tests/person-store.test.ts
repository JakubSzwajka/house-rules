import { expect, layer } from "@effect/vitest";
import { ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Person, PersonStore } from "../../index.js";
import { stores } from "./stores.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const record = (
  id: string,
  displayName = "Ada Lovelace",
  createdAt = 1_700_000_000_123,
): Person => ({
  id: ActorId.make(id),
  displayName,
  createdAt,
});

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `PersonStore on ${name}`,
    (it) => {
      it.effect("inserts and finds a person with its creation time to the millisecond", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const first = record("insert");
          expect(yield* store.find(first.id)).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.insertIfFree(first))).toBe(true);
          expect(yield* store.find(first.id)).toEqual(first);
        }),
      );
      it.effect("an id that is taken is refused and the first row stays", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const first = record("taken");
          yield* UnitOfWork.atomic(store.insertIfFree(first));
          expect(yield* UnitOfWork.atomic(store.insertIfFree(record("taken", "Other")))).toBe(
            false,
          );
          expect(yield* store.find(first.id)).toEqual(first);
        }),
      );
      it.effect("renames and keeps the creation time", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const first = record("rename");
          yield* UnitOfWork.atomic(store.insertIfFree(first));
          expect(yield* UnitOfWork.atomic(store.rename(first.id, "Grace Hopper"))).toEqual({
            ...first,
            displayName: "Grace Hopper",
          });
          expect(yield* store.find(first.id)).toEqual({ ...first, displayName: "Grace Hopper" });
          expect(
            yield* UnitOfWork.atomic(store.rename(ActorId.make("missing"), "Nobody")),
          ).toBeUndefined();
        }),
      );
      it.effect("erases one person and leaves the others", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          yield* UnitOfWork.atomic(
            Effect.forEach([record("erase-one"), record("erase-keep")], (p) =>
              store.insertIfFree(p),
            ),
          );
          yield* UnitOfWork.atomic(store.erase(ActorId.make("erase-one")));
          expect(yield* store.find(ActorId.make("erase-one"))).toBeUndefined();
          expect(yield* store.find(ActorId.make("erase-keep"))).toBeDefined();
        }),
      );
      it.effect("every write requires an open unit", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const calls = [
            store.insertIfFree(record("outside")),
            store.rename(ActorId.make("outside"), "changed"),
            store.erase(ActorId.make("outside")),
          ];
          for (const call of calls) expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find(ActorId.make("outside"))).toBeUndefined();
        }),
      );
      it.effect("rolls back insert, rename and erase together", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const renamed = record("rollback-rename");
          const erased = record("rollback-erase");
          yield* UnitOfWork.atomic(Effect.forEach([renamed, erased], (p) => store.insertIfFree(p)));
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* store.insertIfFree(record("rollback-insert"));
                yield* store.rename(renamed.id, "changed");
                yield* store.erase(erased.id);
                return yield* new Rollback();
              }),
            ),
          );
          expect(error).toBeInstanceOf(Rollback);
          expect(yield* store.find(ActorId.make("rollback-insert"))).toBeUndefined();
          expect(yield* store.find(renamed.id)).toEqual(renamed);
          expect(yield* store.find(erased.id)).toEqual(erased);
        }),
      );
      it.effect("restores handle ownership on rollback and releases it on erase", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const original = {
            ...record("handle-original"),
            kind: "person" as const,
            handle: "reusable-handle",
            createdBy: null,
            disabledAt: null,
          };
          const replacement = { ...original, id: ActorId.make("handle-replacement") };
          yield* UnitOfWork.atomic(store.insertPrincipal(original));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.erase(original.id);
                  expect(yield* store.insertPrincipal(replacement)).toBe(true);
                  yield* store.rename(replacement.id, "Changed");
                  yield* store.disable(replacement.id, 1234);
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.principalByHandle(original.handle)).toEqual(original);
          expect(yield* store.principal(replacement.id)).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.insertPrincipal(replacement))).toBe(false);
          yield* UnitOfWork.atomic(store.erase(original.id));
          expect(yield* store.principalByHandle(original.handle)).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.insertPrincipal(replacement))).toBe(true);
          expect(yield* UnitOfWork.atomic(store.lockPrincipal(original.handle))).toEqual(
            replacement,
          );
        }),
      );
      it.effect("reads return independent data", () =>
        Effect.gen(function* () {
          const store = yield* PersonStore;
          const first = record("copy");
          yield* UnitOfWork.atomic(store.insertIfFree(first));
          const found = yield* store.find(first.id);
          expect(found).toEqual(first);
          expect(found).not.toBe(first);
        }),
      );
    },
  );
}
