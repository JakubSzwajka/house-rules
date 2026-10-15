import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Clock, Deferred, Effect, Fiber, Layer, Result } from "effect";
import { Base64 } from "effect/encoding";
import {
  Accounts,
  AccountsIssuer,
  AccountStore,
  InvalidCredentials,
  Lockout,
  type PasswordHash,
  PasswordIterations,
  type SignInOutcome,
} from "../../index.js";
import { record, stores } from "./stores.js";

const issuer = AccountsIssuer.ephemeral({ issuer: "https://accounts.example.test" });
const accountsOn = (store: Layer.Layer<AccountStore>) =>
  // Fresh, or the memo map hands back the Accounts already built on the plain store.
  Layer.fresh(Accounts.layer).pipe(Layer.provide(Layer.merge(store, issuer)));

const refusal = (outcome: SignInOutcome) =>
  Result.match(outcome, { onSuccess: () => undefined, onFailure: (error) => error });

const legacyHash = (password: string, iterations: number) =>
  // An independent PBKDF2 record, as an older policy would have stored it.
  Effect.gen(function* () {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const { subtle } = globalThis.crypto;
    const key = yield* Effect.promise(() =>
      subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]),
    );
    const bits = yield* Effect.promise(() =>
      subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
    );
    const record: PasswordHash = {
      algorithm: "PBKDF2-SHA256",
      iterations,
      salt: Base64.encode(salt),
      hash: Base64.encode(new Uint8Array(bits)),
    };
    return record;
  });

for (const { name, unitsRunSideBySide, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Accounts on the ${name} store`,
    (it) => {
      it.effect("Accounts locks an account after repeated failures through this store", () =>
        Effect.gen(function* () {
          const accounts = yield* Accounts;
          const store = yield* AccountStore;
          const email = `lockout-${name}@example.test`;
          const { accountId } = yield* UnitOfWork.atomic(
            accounts.signUp({ email, password: "correct horse", displayName: "Lin" }),
          );
          for (let attempt = 0; attempt < Lockout.failures; attempt += 1) {
            const outcome = yield* UnitOfWork.atomic(
              accounts.signIn({ email, password: "wrong password" }),
            );
            expect(refusal(outcome)).toEqual(new InvalidCredentials());
          }
          const locked = yield* UnitOfWork.atomic(
            accounts.signIn({ email, password: "correct horse" }),
          );
          expect(refusal(locked)).toEqual(new InvalidCredentials());
          expect((yield* store.find(accountId))?.lockedUntil).toBeGreaterThan(
            yield* Clock.currentTimeMillis,
          );
        }).pipe(Effect.provide(Accounts.layer.pipe(Layer.provide(issuer)))),
      );
      it.effect("a lock that lands after the hash check refuses the correct password", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const accounts = yield* Accounts;
          const email = `interleaved-${name}@example.test`;
          yield* UnitOfWork.atomic(
            accounts.signUp({ email, password: "correct horse", displayName: "Held" }),
          );
          const lockNow = Effect.forEach(
            Array.from({ length: Lockout.failures }),
            () => accounts.signIn({ email, password: "wrong password" }),
            { discard: true },
          );
          // The account was read and the hash matched; the lock lands just before the admit write.
          const interleaving = AccountStore.of({
            ...store,
            admitIfUnlocked: (id, check) =>
              lockNow.pipe(Effect.andThen(store.admitIfUnlocked(id, check))),
          });
          const outcome = yield* Effect.gen(function* () {
            const slow = yield* Accounts;
            return yield* UnitOfWork.atomic(slow.signIn({ email, password: "correct horse" }));
          }).pipe(Effect.provide(accountsOn(Layer.succeed(AccountStore, interleaving))));
          expect(refusal(outcome)).toEqual(new InvalidCredentials());
          expect((yield* store.findByEmail(email))?.lockedUntil).toBeGreaterThan(
            yield* Clock.currentTimeMillis,
          );
        }).pipe(Effect.provide(Accounts.layer.pipe(Layer.provide(issuer)))),
      );
      it.effect.skipIf(!unitsRunSideBySide)(
        "a lock committed while a correct sign-in is in flight refuses that sign-in",
        () =>
          Effect.gen(function* () {
            const store = yield* AccountStore;
            const accounts = yield* Accounts;
            const email = `held-${name}@example.test`;
            yield* UnitOfWork.atomic(
              accounts.signUp({ email, password: "correct horse", displayName: "Held" }),
            );
            const hashed = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            // The held sign-in has read the account and checked the hash; it pauses before its write.
            const holding = AccountStore.of({
              ...store,
              admitIfUnlocked: (id, check) =>
                Deferred.succeed(hashed, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(store.admitIfUnlocked(id, check)),
                ),
            });
            const held = yield* Effect.forkChild(
              Effect.gen(function* () {
                const slow = yield* Accounts;
                return yield* UnitOfWork.atomic(slow.signIn({ email, password: "correct horse" }));
              }).pipe(Effect.provide(accountsOn(Layer.succeed(AccountStore, holding)))),
            );
            yield* Deferred.await(hashed);
            for (let attempt = 0; attempt < Lockout.failures; attempt += 1) {
              yield* UnitOfWork.atomic(accounts.signIn({ email, password: "wrong password" }));
            }
            expect((yield* store.findByEmail(email))?.lockedUntil).toBeGreaterThan(
              yield* Clock.currentTimeMillis,
            );
            yield* Deferred.succeed(release, undefined);
            expect(refusal(yield* Fiber.join(held))).toEqual(new InvalidCredentials());
            expect((yield* store.findByEmail(email))?.lockedUntil).toBeGreaterThan(
              yield* Clock.currentTimeMillis,
            );
          }).pipe(Effect.provide(Accounts.layer.pipe(Layer.provide(issuer)))),
      );
      it.effect("a sign-in moves a 10,000-iteration record to the current policy", () =>
        Effect.gen(function* () {
          const store = yield* AccountStore;
          const accounts = yield* Accounts;
          const legacy = yield* legacyHash("correct horse", 10_000);
          const account = { ...record("legacy"), password: legacy };
          yield* UnitOfWork.atomic(store.insertIfFree(account));
          const signIn = (password: string) =>
            UnitOfWork.atomic(accounts.signIn({ email: account.email, password }));
          expect(refusal(yield* signIn("wrong horse"))).toEqual(new InvalidCredentials());
          expect((yield* store.find(account.id))?.password).toEqual(legacy);
          expect(Result.isSuccess(yield* signIn("correct horse"))).toBe(true);
          const upgraded = (yield* store.find(account.id))?.password;
          expect(upgraded?.iterations).toBe(PasswordIterations);
          expect(upgraded?.salt).not.toBe(legacy.salt);
          expect(upgraded?.hash).not.toBe(legacy.hash);
          expect(Result.isSuccess(yield* signIn("correct horse"))).toBe(true);
          expect((yield* store.find(account.id))?.password).toEqual(upgraded);
        }).pipe(Effect.provide(Accounts.layer.pipe(Layer.provide(issuer)))),
      );
    },
  );
}
