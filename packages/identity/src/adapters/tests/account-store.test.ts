import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { AccountId, AccountStore } from "../../index.js";
import { record, stores } from "./password-stores.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const rollingBack = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flip(UnitOfWork.atomic(effect.pipe(Effect.andThen(Effect.fail(new Rollback())))));

const at = 1_800_000_000_000;
const limit = { now: at, failures: 3, lockUntil: at + 1000 };

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `AccountStore on ${name}`,
    (it) => {
      it.effect("inserts and finds an account by id and by email, to the millisecond", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const account = record("insert");
          expect(yield* store.find(account.id)).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.insertIfFree(account))).toBe(true);
          expect(yield* store.find(account.id)).toEqual(account);
          expect(yield* store.findByEmail(account.email)).toEqual(account);
          expect(yield* store.findByEmail("nobody@example.test")).toBeUndefined();
        }),
      );
      it.effect("a taken email or id is refused and the first row stays", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const first = record("first", "taken@example.test");
          yield* UnitOfWork.atomic(store.insertIfFree(first));
          expect(
            yield* UnitOfWork.atomic(store.insertIfFree(record("second", "taken@example.test"))),
          ).toBe(false);
          expect(
            yield* UnitOfWork.atomic(store.insertIfFree(record("first", "x@example.test"))),
          ).toBe(false);
          expect(yield* store.findByEmail("taken@example.test")).toEqual(first);
          expect(yield* store.find(AccountId.make("second"))).toBeUndefined();
        }),
      );
      it.effect("every write fails with NoOpenUnit outside a unit and changes nothing", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const account = record("no-unit");
          expect(yield* Effect.flip(store.insertIfFree(account))).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find(account.id)).toBeUndefined();
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          const writes = [
            Effect.asVoid(store.recordFailureIfUnlocked(account.id, limit)),
            Effect.asVoid(
              store.admitIfUnlocked(account.id, { now: at, password: account.password }),
            ),
            Effect.asVoid(store.setPassword(account.id, { ...account.password, hash: "bmV3" })),
          ];
          for (const write of writes) {
            expect(yield* Effect.flip(write)).toBeInstanceOf(NoOpenUnit);
          }
          expect(yield* store.find(account.id)).toEqual(account);
        }),
      );
      it.effect("a failure inside the unit rolls every write back", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const fresh = record("rolled-back");
          expect(yield* rollingBack(store.insertIfFree(fresh))).toBeInstanceOf(Rollback);
          expect(yield* store.find(fresh.id)).toBeUndefined();
          const account = record("kept");
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          yield* rollingBack(
            Effect.gen(function* () {
              for (let attempt = 0; attempt < limit.failures; attempt += 1) {
                yield* store.recordFailureIfUnlocked(account.id, limit);
              }
              yield* store.setPassword(account.id, { ...account.password, hash: "bmV3" });
            }),
          );
          expect(yield* store.find(account.id)).toEqual(account);
        }),
      );
      it.effect("counts failures and locks at the limit in one write, to the millisecond", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const account = record("counter");
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          const count = (now: number) =>
            UnitOfWork.atomic(store.recordFailureIfUnlocked(account.id, { ...limit, now }));
          expect(yield* count(at)).toEqual({ failedAttempts: 1, lockedUntil: null });
          expect(yield* count(at)).toEqual({ failedAttempts: 2, lockedUntil: null });
          expect(yield* count(at)).toEqual({ failedAttempts: 0, lockedUntil: at + 1000 });
          expect(yield* count(at + 999)).toBeUndefined();
          expect(yield* store.find(account.id)).toEqual({
            ...account,
            failedAttempts: 0,
            lockedUntil: at + 1000,
          });
          expect(yield* count(at + 1000)).toEqual({ failedAttempts: 1, lockedUntil: null });
          expect(
            yield* UnitOfWork.atomic(
              store.recordFailureIfUnlocked(AccountId.make("nobody"), limit),
            ),
          ).toBeUndefined();
        }),
      );
      it.effect("admits only an unlocked account that still has the checked password", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const account = record("admit");
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          const admit = (now: number, password = account.password) =>
            UnitOfWork.atomic(store.admitIfUnlocked(account.id, { now, password }));
          for (let attempt = 0; attempt < limit.failures; attempt += 1) {
            yield* UnitOfWork.atomic(store.recordFailureIfUnlocked(account.id, limit));
          }
          expect(yield* admit(at + 999)).toBe(false);
          expect((yield* store.find(account.id))?.lockedUntil).toBe(at + 1000);
          expect(yield* admit(at + 1000, { ...account.password, hash: "b3RoZXI=" })).toBe(false);
          expect(yield* admit(at + 1000)).toBe(true);
          expect(yield* store.find(account.id)).toEqual(account);
          expect(
            yield* UnitOfWork.atomic(
              store.admitIfUnlocked(AccountId.make("nobody"), {
                now: at,
                password: account.password,
              }),
            ),
          ).toBe(false);
        }),
      );
      it.effect("sets a password and clears the failures", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const account = record("set-password");
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          const password = { ...account.password, iterations: 700_000, hash: "bmV3" };
          yield* UnitOfWork.atomic(store.recordFailureIfUnlocked(account.id, limit));
          expect(yield* UnitOfWork.atomic(store.setPassword(account.id, password))).toBe(true);
          expect(yield* store.find(account.id)).toEqual({ ...account, password });
          expect(
            yield* UnitOfWork.atomic(store.setPassword(AccountId.make("nobody"), password)),
          ).toBe(false);
        }),
      );
    },
  );
}
