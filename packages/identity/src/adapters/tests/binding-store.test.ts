import { expect, layer } from "@effect/vitest";
import { ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { BindingStore } from "../../index.js";
import { stores } from "./stores.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const login = (subject: string, issuer = "https://issuer.test") => ({ issuer, subject });
const keysOf = (rows: ReadonlyArray<{ issuer: string; subject: string }>) =>
  rows.map(({ issuer, subject }) => ({ issuer, subject }));

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `BindingStore on ${name}`,
    (it) => {
      it.effect("claims a free key and answers the holder of a taken one", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const a = ActorId.make("claim-a");
          const b = ActorId.make("claim-b");
          expect(yield* store.find(login("claim"))).toBeUndefined();
          expect(yield* UnitOfWork.atomic(store.claim(login("claim"), a))).toBe(a);
          expect(yield* UnitOfWork.atomic(store.claim(login("claim"), b))).toBe(a);
          expect(yield* store.find(login("claim"))).toBe(a);
          expect(yield* store.find(login("claim", "https://other.test"))).toBeUndefined();
        }),
      );
      it.effect("two concurrent claims of one login leave one binding and one winner", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const a = ActorId.make("race-a");
          const b = ActorId.make("race-b");
          const [first, second] = yield* Effect.all(
            [
              UnitOfWork.atomic(store.claim(login("race"), a)),
              UnitOfWork.atomic(store.claim(login("race"), b)),
            ],
            { concurrency: "unbounded" },
          );
          expect(first).toBe(second);
          expect([a, b]).toContain(first);
          expect(yield* store.find(login("race"))).toBe(first);
          const held = [...(yield* store.list(a)), ...(yield* store.list(b))];
          expect(keysOf(held)).toEqual([login("race")]);
        }),
      );
      it.effect("lists one actor's bindings by issuer then subject", () =>
        Effect.gen(function* () {
          const actor = ActorId.make("list-actor");
          const store = yield* BindingStore;
          yield* UnitOfWork.atomic(
            Effect.forEach(
              [login("list-z"), login("list-a", "https://b.test"), login("list-a")],
              (key) => store.claim(key, actor),
            ),
          );
          yield* UnitOfWork.atomic(store.claim(login("list-other"), ActorId.make("someone")));
          const rows = yield* store.list(actor);
          expect(keysOf(rows)).toEqual([
            login("list-a", "https://b.test"),
            login("list-a"),
            login("list-z"),
          ]);
          for (const row of rows) {
            expect(row.actorId).toBe(actor);
            expect(Number.isInteger(row.createdAt)).toBe(true);
          }
        }),
      );
      it.effect("removes a key only for the actor that holds it", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const owner = ActorId.make("remove-owner");
          yield* UnitOfWork.atomic(store.claim(login("remove"), owner));
          yield* UnitOfWork.atomic(store.remove(ActorId.make("remove-stranger"), login("remove")));
          expect(yield* store.find(login("remove"))).toBe(owner);
          yield* UnitOfWork.atomic(store.remove(owner, login("remove")));
          expect(yield* store.find(login("remove"))).toBeUndefined();
        }),
      );
      it.effect("removes every binding of one actor and leaves the others", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const gone = ActorId.make("all-gone");
          const kept = ActorId.make("all-kept");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* store.claim(login("all-one"), gone);
              yield* store.claim(login("all-two", "https://b.test"), gone);
              yield* store.claim(login("all-three"), kept);
            }),
          );
          yield* UnitOfWork.atomic(store.removeAll(gone));
          expect(yield* store.list(gone)).toEqual([]);
          expect(keysOf(yield* store.list(kept))).toEqual([login("all-three")]);
        }),
      );
      it.effect("every write requires an open unit", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const actor = ActorId.make("outside");
          const calls = [
            store.claim(login("outside"), actor),
            store.remove(actor, login("outside")),
            store.removeAll(actor),
          ];
          for (const call of calls) expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find(login("outside"))).toBeUndefined();
        }),
      );
      it.effect("rolls back claim, remove and removeAll together", () =>
        Effect.gen(function* () {
          const store = yield* BindingStore;
          const one = ActorId.make("rollback-one");
          const two = ActorId.make("rollback-two");
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* store.claim(login("rollback-remove"), one);
              yield* store.claim(login("rollback-all"), two);
            }),
          );
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* store.claim(login("rollback-new"), one);
                yield* store.remove(one, login("rollback-remove"));
                yield* store.removeAll(two);
                return yield* new Rollback();
              }),
            ),
          );
          expect(error).toBeInstanceOf(Rollback);
          expect(yield* store.find(login("rollback-new"))).toBeUndefined();
          expect(yield* store.find(login("rollback-remove"))).toBe(one);
          expect(yield* store.find(login("rollback-all"))).toBe(two);
        }),
      );
    },
  );
}
