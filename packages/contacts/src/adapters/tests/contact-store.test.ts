import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { type Contact, ContactConflict, ContactStore } from "../../index.js";
import { stores } from "./stores.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
const owner = (id: string) => ({ kind: "person", id });
const record = (id: string, ownerId = id, purposes = ["general"], createdAt = 100): Contact => ({
  id,
  owner: owner(ownerId),
  type: "email",
  valueNormalized: `${id}@example.com`,
  details: { extra: { nested: [true, null] } },
  purposes,
  primaryPurposes: [],
  verifiedAt: null,
  createdAt,
});
for (const { name, layer: world } of stores)
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `ContactStore on ${name}`,
    (it) => {
      it.effect("orders, pages, isolates owners and decodes extra details", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("z", "page", ["general"], 101),
                record("b", "page"),
                record("a", "page"),
                record("other"),
              ],
              (row) => store.insert(row),
            ),
          );
          expect((yield* store.list(owner("page"), { size: 2 })).map((x) => x.id)).toEqual([
            "a",
            "b",
          ]);
          expect(
            (yield* store.list(owner("page"), { size: 5, after: { createdAt: 100, id: "b" } })).map(
              (x) => x.id,
            ),
          ).toEqual(["z"]);
          expect(yield* store.get("a")).toEqual(record("a", "page"));
          expect(yield* store.get("missing")).toBeUndefined();
        }),
      );
      it.effect("enforces normalized uniqueness within owner and type only", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          const first = record("unique", "uniqueness");
          yield* UnitOfWork.atomic(store.insert(first));
          expect(
            yield* Effect.flip(UnitOfWork.atomic(store.insert({ ...first, id: "duplicate" }))),
          ).toBeInstanceOf(ContactConflict);
          yield* UnitOfWork.atomic(
            store.insert({ ...first, id: "different-owner", owner: owner("different") }),
          );
          yield* UnitOfWork.atomic(store.insert({ ...first, id: "different-type", type: "phone" }));
          yield* UnitOfWork.atomic(
            store.insert({ ...first, id: "postal-one", type: "postal", valueNormalized: null }),
          );
          yield* UnitOfWork.atomic(
            store.insert({ ...first, id: "postal-two", type: "postal", valueNormalized: null }),
          );
        }),
      );
      it.effect("moves only selected primary purposes and reports their previous contacts", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [
                record("multi", "primary", ["notifications", "billing"]),
                record("billing", "primary", ["notifications", "billing"]),
                record("shipping", "primary", ["shipping"]),
              ],
              (row) => store.insert(row),
            ),
          );
          yield* UnitOfWork.atomic(store.setPrimary("multi"));
          yield* UnitOfWork.atomic(store.setPrimary("shipping"));
          const selection = yield* UnitOfWork.atomic(
            store.setPrimary("billing", ["notifications"]),
          );
          expect(selection?.previousContactIds).toEqual({ notifications: "multi" });
          expect(selection?.contact.primaryPurposes).toEqual(["notifications"]);
          expect((yield* store.get("multi"))?.primaryPurposes).toEqual(["billing"]);
          expect((yield* store.get("shipping"))?.primaryPurposes).toEqual(["shipping"]);
          expect((yield* store.primaryFor(owner("primary"), "email", "billing", false))?.id).toBe(
            "multi",
          );
          expect(
            (yield* store.primaryFor(owner("primary"), "email", "notifications", false))?.id,
          ).toBe("billing");
          expect(
            (yield* UnitOfWork.atomic(store.setPrimary("billing", ["notifications"])))
              ?.previousContactIds,
          ).toEqual({});
          const all = yield* UnitOfWork.atomic(store.setPrimary("shipping", ["shipping"]));
          expect(all?.previousContactIds).toEqual({});
          const both = yield* UnitOfWork.atomic(store.setPrimary("billing"));
          expect(both?.previousContactIds).toEqual({ billing: "multi" });
          expect((yield* store.get("multi"))?.primaryPurposes).toEqual([]);
          expect(
            yield* store.primaryFor(owner("primary"), "email", "billing", true),
          ).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.setPrimary("missing"))).toBeUndefined();
        }),
      );
      it.effect("rotates hashes, enforces strict expiry and consumes exactly once", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          yield* UnitOfWork.atomic(store.insert(record("tokens")));
          yield* UnitOfWork.atomic(store.replaceToken("tokens", "old-hash", 200));
          yield* UnitOfWork.atomic(store.replaceToken("tokens", "new-hash", 300));
          expect(yield* UnitOfWork.atomic(store.consumeToken("old-hash", 100))).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.consumeToken("new-hash", 300))).toBeUndefined();
          const contact = yield* UnitOfWork.atomic(store.consumeToken("new-hash", 299));
          expect(contact?.verifiedAt).toBe(299);
          expect(yield* UnitOfWork.atomic(store.consumeToken("new-hash", 299))).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.replaceToken("missing", "hash", 300))).toBe(false);
        }),
      );
      it.effect("requires a live unit for every write", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          for (const write of [
            store.insert(record("outside")),
            store.remove("outside"),
            store.setPrimary("outside"),
            store.replaceToken("outside", "hash", 1),
            store.consumeToken("hash", 0),
            store.importVerified({ ...record("outside"), verifiedAt: 1 }),
            store.erase(owner("outside")),
          ])
            expect(yield* Effect.flip(write)).toBeInstanceOf(NoOpenUnit);
        }),
      );
      it.effect(
        "rolls back inserts, primary displacement, verification, rotation and cascades",
        () =>
          Effect.gen(function* () {
            const store = yield* ContactStore;
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* store.insert(record("rollback-first", "rollback"));
                yield* store.insert(record("rollback-second", "rollback"));
                yield* store.setPrimary("rollback-first");
                yield* store.replaceToken("rollback-first", "original", 500);
              }),
            );
            expect(
              yield* Effect.flip(
                UnitOfWork.atomic(
                  Effect.gen(function* () {
                    yield* store.insert(record("rollback-insert", "rollback"));
                    yield* store.setPrimary("rollback-second");
                    yield* store.replaceToken("rollback-first", "rotated", 500);
                    yield* store.consumeToken("rotated", 400);
                    yield* store.importVerified({
                      ...record("rollback-import", "rollback"),
                      verifiedAt: 400,
                    });
                    yield* store.remove("rollback-first");
                    yield* store.erase(owner("rollback"));
                    return yield* new Rollback();
                  }),
                ),
              ),
            ).toBeInstanceOf(Rollback);
            expect(
              (yield* store.list(owner("rollback"), { size: 10 })).map((row) => row.id),
            ).toEqual(["rollback-first", "rollback-second"]);
            expect((yield* store.get("rollback-first"))?.primaryPurposes).toEqual(["general"]);
            expect((yield* store.get("rollback-first"))?.verifiedAt).toBeNull();
            expect(
              (yield* UnitOfWork.atomic(store.consumeToken("original", 400)))?.verifiedAt,
            ).toBe(400);
            yield* UnitOfWork.atomic(store.erase(owner("rollback")));
            expect(yield* store.list(owner("rollback"), { size: 10 })).toEqual([]);
            expect(yield* UnitOfWork.atomic(store.consumeToken("original", 401))).toBeUndefined();
          }),
      );
      it.effect("does not expose mutable storage references", () =>
        Effect.gen(function* () {
          const store = yield* ContactStore;
          const contact = record("copy");
          yield* UnitOfWork.atomic(store.insert(contact));
          const found = yield* store.get("copy");
          if (found) Object.assign(found.details, { malicious: true });
          Object.assign(contact.details, { changed: true });
          expect((yield* store.get("copy"))?.details).toEqual({ extra: { nested: [true, null] } });
        }),
      );
    },
  );
