import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { PushStore, type PushSubscription } from "../../index.js";
import { pushStores } from "./stores.js";

const owner = { kind: "person", id: "store-suite" };
const record = (name: string): PushSubscription => ({
  endpoint: `https://push.example/${name}`,
  owner,
  keys: { p256dh: "public-key", auth: "auth-key" },
  userAgent: "store suite",
  createdAt: 1_800_000_000_000,
});
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
for (const store of pushStores) {
  layer(store.layer, { excludeTestServices: true, timeout: "30 seconds" })(
    `PushStore ${store.name}`,
    (test) => {
      test.effect("round-trips subscriptions and scopes owner reads by kind and id", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("roundtrip");
          yield* UnitOfWork.atomic(pushStore.put(row));
          expect(yield* pushStore.get(row.endpoint)).toEqual(row);
          expect(yield* pushStore.listMine(owner)).toContainEqual(row);
          expect(yield* pushStore.listOwner(owner)).toContainEqual(row);
          expect(yield* pushStore.listMine({ kind: "person", id: "other" })).toEqual([]);
          expect(yield* pushStore.listOwner({ kind: "org", id: owner.id })).toEqual([]);
        }),
      );
      test.effect("remove returns true only when it deletes a row", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("remove");
          expect(yield* UnitOfWork.atomic(pushStore.remove(row.endpoint))).toBe(false);
          yield* UnitOfWork.atomic(pushStore.put(row));
          expect(yield* UnitOfWork.atomic(pushStore.remove(row.endpoint))).toBe(true);
          expect(yield* UnitOfWork.atomic(pushStore.remove(row.endpoint))).toBe(false);
          expect(yield* pushStore.get(row.endpoint)).toBeUndefined();
        }),
      );
      test.effect("expiry is a soft mark hidden by every active read", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("expire");
          expect(yield* UnitOfWork.atomic(pushStore.expired(row.endpoint, 42))).toBe(false);
          yield* UnitOfWork.atomic(pushStore.put(row));
          expect(yield* UnitOfWork.atomic(pushStore.expired(row.endpoint, 42))).toBe(true);
          expect(yield* pushStore.getIncludingExpired(row.endpoint)).toEqual({
            ...row,
            expiredAt: 42,
          });
          expect(yield* pushStore.get(row.endpoint)).toBeUndefined();
          expect(yield* pushStore.listMine(owner)).not.toContainEqual(row);
          expect((yield* pushStore.listMine(owner)).some((x) => x.endpoint === row.endpoint)).toBe(
            false,
          );
          expect((yield* pushStore.listOwner(owner)).some((x) => x.endpoint === row.endpoint)).toBe(
            false,
          );
          expect(yield* UnitOfWork.atomic(pushStore.expired(row.endpoint, 99))).toBe(false);
          expect((yield* pushStore.getIncludingExpired(row.endpoint))?.expiredAt).toBe(42);
        }),
      );
      test.effect("put upserts all fields on endpoint conflict and clears expiry", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("upsert");
          yield* UnitOfWork.atomic(pushStore.put(row));
          yield* UnitOfWork.atomic(pushStore.expired(row.endpoint, 42));
          const replacement = {
            ...row,
            owner: { kind: "org", id: "new-owner" },
            keys: { p256dh: "new-key", auth: "new-auth" },
            createdAt: row.createdAt + 1,
          };
          const { userAgent: _, ...withoutAgent } = replacement;
          yield* UnitOfWork.atomic(pushStore.put(withoutAgent));
          expect(yield* pushStore.get(row.endpoint)).toEqual(withoutAgent);
          expect((yield* pushStore.listMine(owner)).some((x) => x.endpoint === row.endpoint)).toBe(
            false,
          );
          expect(yield* pushStore.listOwner(replacement.owner)).toEqual([withoutAgent]);
        }),
      );
      test.effect("put preserves an explicit expiry for inserts and updates", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = { ...record("put-expired"), expiredAt: 42 };
          yield* UnitOfWork.atomic(pushStore.put(row));
          yield* UnitOfWork.atomic(pushStore.put({ ...row, expiredAt: 43 }));
          expect(yield* pushStore.get(row.endpoint)).toBeUndefined();
          expect((yield* pushStore.getIncludingExpired(row.endpoint))?.expiredAt).toBe(43);
        }),
      );
      test.effect("erase hard-deletes active and expired rows and leaves other owners alone", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const erasedOwner = { kind: "person", id: "erase-owner" };
          const erased = { ...record("erase-active"), owner: erasedOwner };
          const expired = { ...record("erase-expired"), owner: erasedOwner, expiredAt: 42 };
          const kept = { ...record("erase-keep"), owner: { kind: "org", id: erasedOwner.id } };
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const row of [erased, expired, kept]) yield* pushStore.put(row);
              yield* pushStore.erase(erasedOwner);
            }),
          );
          expect(yield* pushStore.getIncludingExpired(erased.endpoint)).toBeUndefined();
          expect(yield* pushStore.getIncludingExpired(expired.endpoint)).toBeUndefined();
          expect(yield* pushStore.get(kept.endpoint)).toEqual(kept);
        }),
      );
      test.effect("every store write requires an open unit", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("outside");
          expect(yield* Effect.flip(pushStore.put(row))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(pushStore.remove(row.endpoint))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(pushStore.expired(row.endpoint, 42))).toBeInstanceOf(
            NoOpenUnit,
          );
          expect(yield* Effect.flip(pushStore.erase(owner))).toBeInstanceOf(NoOpenUnit);
        }),
      );
      test.effect("rollback restores puts, removes, expiry and erase", () =>
        Effect.gen(function* () {
          const pushStore = yield* PushStore;
          const row = record("rollback");
          const inserted = record("rollback-insert");
          yield* UnitOfWork.atomic(pushStore.put(row));
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* pushStore.expired(row.endpoint, 42);
                yield* pushStore.put({ ...row, createdAt: 123 });
                yield* pushStore.remove(row.endpoint);
                yield* pushStore.put(inserted);
                yield* pushStore.erase(owner);
                return yield* new Rollback();
              }),
            ),
          );
          expect(error).toBeInstanceOf(Rollback);
          expect(yield* pushStore.get(row.endpoint)).toEqual(row);
          expect(yield* pushStore.getIncludingExpired(inserted.endpoint)).toBeUndefined();
        }),
      );
    },
  );
}
