import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Layer, Result } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
import { decodeJwt } from "jose";
import {
  AccountEmailTaken,
  AccountId,
  AccountInputInvalid,
  Accounts,
  AccountsIssuer,
  AccountStore,
  InvalidCredentials,
  Lockout,
  memoryAccountStore,
  PasswordIterations,
} from "../index.js";

const issuer = AccountsIssuer.ephemeral({ issuer: "https://accounts.example.test" });
const world = Accounts.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(memoryAccountStore(), issuer, memoryUnitOfWork)),
);

const password = "correct horse battery";
const signUp = (email: string, displayName = "Ada Lovelace", secret = password) =>
  Effect.gen(function* () {
    return yield* UnitOfWork.atomic(
      (yield* Accounts).signUp({ email, password: secret, displayName }),
    );
  });
const signIn = (email: string, secret: string) =>
  Effect.gen(function* () {
    return yield* UnitOfWork.atomic((yield* Accounts).signIn({ email, password: secret }));
  });
const derived = (secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
  Effect.gen(function* () {
    const { subtle } = globalThis.crypto;
    const key = yield* Effect.promise(() =>
      subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]),
    );
    const bits = yield* Effect.promise(() =>
      subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
    );
    return new Uint8Array(bits);
  });
const refusal = <A>(outcome: Result.Result<A, InvalidCredentials>) =>
  Result.match(outcome, { onSuccess: () => undefined, onFailure: (error) => error });

it.layer(world)("Accounts", (test) => {
  test.effect("signs up and signs in, with a token for the account and its display name", () =>
    Effect.gen(function* () {
      const signedUp = yield* signUp("  Ada@Example.TEST ");
      const { accountId } = signedUp;
      // Sign-up signs the new account in at once, with the same claims as a sign-in.
      expect(decodeJwt(signedUp.token)).toMatchObject({ sub: accountId, name: "Ada Lovelace" });
      expect(signedUp.expiresAt).toBe((decodeJwt(signedUp.token).exp ?? 0) * 1000);
      const outcome = yield* signIn("ada@example.test", password);
      expect(Result.isSuccess(outcome)).toBe(true);
      const { token, expiresAt } = Result.getOrThrow(outcome);
      const claims = decodeJwt(token);
      expect(claims.sub).toBe(accountId);
      expect(claims["name"]).toBe("Ada Lovelace");
      expect(expiresAt).toBe((claims.exp ?? 0) * 1000);
      expect(Result.isSuccess(yield* signIn(" ADA@example.test", password))).toBe(true);
    }),
  );
  test.effect("a wrong password and an unknown email get the same InvalidCredentials", () =>
    Effect.gen(function* () {
      yield* signUp("grace@example.test", "Grace");
      expect(refusal(yield* signIn("grace@example.test", "not the password"))).toEqual(
        new InvalidCredentials(),
      );
      expect(refusal(yield* signIn("nobody@example.test", password))).toEqual(
        new InvalidCredentials(),
      );
      expect(refusal(yield* signIn("not an email", password))).toEqual(new InvalidCredentials());
    }),
  );
  test.effect("locks after five failures for fifteen minutes, then lets the owner in", () =>
    Effect.gen(function* () {
      const email = "lin@example.test";
      const start = yield* Clock.currentTimeMillis;
      const { accountId } = yield* signUp(email, "Lin");
      for (let attempt = 0; attempt < Lockout.failures; attempt += 1) {
        expect(refusal(yield* signIn(email, "wrong password"))).toEqual(new InvalidCredentials());
      }
      const stored = yield* (yield* AccountStore).find(accountId);
      expect(stored?.lockedUntil).toBe(start + Lockout.minutes * 60_000);
      // A locked account answers exactly like a wrong password or an unknown email.
      expect(refusal(yield* signIn(email, password))).toEqual(new InvalidCredentials());
      expect(refusal(yield* signIn(email, "wrong password"))).toEqual(new InvalidCredentials());
      expect(refusal(yield* signIn("nobody@example.test", password))).toEqual(
        new InvalidCredentials(),
      );
      yield* TestClock.adjust("14 minutes");
      expect(refusal(yield* signIn(email, password))).toEqual(new InvalidCredentials());
      yield* TestClock.adjust("1 minute");
      expect(Result.isSuccess(yield* signIn(email, password))).toBe(true);
      const account = yield* (yield* AccountStore).findByEmail(email);
      expect(account).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    }),
  );
  test.effect("a success resets the failure count", () =>
    Effect.gen(function* () {
      const email = "reset@example.test";
      yield* signUp(email);
      for (let attempt = 0; attempt < Lockout.failures - 1; attempt += 1) {
        yield* signIn(email, "wrong password");
      }
      expect(Result.isSuccess(yield* signIn(email, password))).toBe(true);
      for (let attempt = 0; attempt < Lockout.failures - 1; attempt += 1) {
        expect(refusal(yield* signIn(email, "wrong password"))).toBeInstanceOf(InvalidCredentials);
      }
      expect(Result.isSuccess(yield* signIn(email, password))).toBe(true);
    }),
  );
  test.effect("refuses a taken email, a bad email, a short or long password, a blank name", () =>
    Effect.gen(function* () {
      yield* signUp("taken@example.test");
      expect(yield* Effect.flip(signUp(" TAKEN@example.test"))).toEqual(new AccountEmailTaken());
      const bad = [
        ["no-at-sign", "Ada", password],
        ["a@b.test", "Ada", "x".repeat(9)],
        ["a@b.test", "Ada", "x".repeat(201)],
        ["a@b.test", "   ", password],
        ["a@b.test", "x".repeat(121), password],
      ] as const;
      for (const [email, name, secret] of bad) {
        const error = yield* Effect.flip(signUp(email, name, secret));
        expect(error).toBeInstanceOf(AccountInputInvalid);
        expect(JSON.stringify(error)).not.toContain(secret);
      }
      expect(
        Result.isSuccess(
          yield* signUp("ten@example.test", "Ten", "x".repeat(10)).pipe(
            Effect.andThen(signIn("ten@example.test", "x".repeat(10))),
          ),
        ),
      ).toBe(true);
    }),
  );
  test.effect("the stored hash is salted PBKDF2, never the password, and unique per account", () =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const one = yield* signUp("one@example.test");
      const two = yield* signUp("two@example.test");
      const first = yield* accounts.find(one.accountId);
      const second = yield* accounts.find(two.accountId);
      expect(first?.password.algorithm).toBe("PBKDF2-SHA256");
      expect(first?.password.iterations).toBe(PasswordIterations);
      expect(PasswordIterations).toBeGreaterThanOrEqual(600_000);
      expect(JSON.stringify(first)).not.toContain(password);
      expect(first?.password.hash).not.toBe(second?.password.hash);
      expect(first?.password.salt).not.toBe(second?.password.salt);
      expect(one.accountId).not.toBe(two.accountId);
    }),
  );
  test.effect("change password needs the current one, checks the policy, and swaps the hash", () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const email = "change@example.test";
      const { accountId } = yield* signUp(email);
      const change = (current: string, next: string) =>
        UnitOfWork.atomic(accounts.changePassword({ accountId, current, next }));
      expect(refusal(yield* change("not the password", "a brand new secret"))).toEqual(
        new InvalidCredentials(),
      );
      expect(yield* Effect.flip(change(password, "short"))).toBeInstanceOf(AccountInputInvalid);
      expect(Result.isSuccess(yield* change(password, "a brand new secret"))).toBe(true);
      expect(refusal(yield* signIn(email, password))).toBeInstanceOf(InvalidCredentials);
      expect(Result.isSuccess(yield* signIn(email, "a brand new secret"))).toBe(true);
      expect((yield* (yield* AccountStore).find(accountId))?.failedAttempts).toBe(0);
    }),
  );
  test.effect("wrong current passwords count toward the lock, and a locked change is refused", () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const email = "guess@example.test";
      const { accountId } = yield* signUp(email);
      const change = (current: string) =>
        UnitOfWork.atomic(accounts.changePassword({ accountId, current, next: "stolen secret!" }));
      for (let attempt = 0; attempt < Lockout.failures + 1; attempt += 1) {
        expect(refusal(yield* change(`guess number ${attempt}`))).toEqual(new InvalidCredentials());
      }
      const stored = yield* (yield* AccountStore).find(accountId);
      expect(stored?.lockedUntil).toBeGreaterThan(yield* Clock.currentTimeMillis);
      expect(refusal(yield* change(password))).toEqual(new InvalidCredentials());
      expect(refusal(yield* signIn(email, password))).toEqual(new InvalidCredentials());
      expect((yield* (yield* AccountStore).find(accountId))?.password).toEqual(stored?.password);
      yield* TestClock.adjust(`${Lockout.minutes} minutes`);
      expect(Result.isSuccess(yield* signIn(email, password))).toBe(true);
    }),
  );
  test.effect("a stored hash off by one byte or one length is refused", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore;
      const salt = new Uint8Array(16).fill(7);
      const exact = yield* derived(password, salt, 1000);
      const flipped = (index: number) => exact.map((byte, at) => (at === index ? byte ^ 1 : byte));
      const variants = {
        exact,
        first: flipped(0),
        last: flipped(exact.length - 1),
        short: exact.subarray(0, exact.length - 1),
        long: Uint8Array.of(...exact, 0),
        empty: new Uint8Array(0),
      };
      const outcomes: Record<string, boolean> = {};
      for (const [label, hash] of Object.entries(variants)) {
        const email = `compare-${label}@example.test`;
        yield* UnitOfWork.atomic(
          store.insertIfFree({
            id: AccountId.make(`compare-${label}`),
            email,
            displayName: "Compare",
            password: {
              algorithm: "PBKDF2-SHA256",
              iterations: 1000,
              salt: Base64.encode(salt),
              hash: Base64.encode(hash),
            },
            failedAttempts: 0,
            lockedUntil: null,
            createdAt: 0,
          }),
        );
        outcomes[label] = Result.isSuccess(yield* signIn(email, password));
      }
      expect(outcomes).toEqual({
        exact: true,
        first: false,
        last: false,
        short: false,
        long: false,
        empty: false,
      });
    }),
  );
  test.effect("every module write fails outside a unit", () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const { accountId } = yield* signUp("unit@example.test");
      expect(
        yield* Effect.flip(
          accounts.signUp({ email: "x@example.test", password, displayName: "X" }),
        ),
      ).toBeInstanceOf(NoOpenUnit);
      expect(
        yield* Effect.flip(accounts.signIn({ email: "unit@example.test", password })),
      ).toBeInstanceOf(NoOpenUnit);
      expect(
        yield* Effect.flip(
          accounts.changePassword({ accountId, current: password, next: "another secret" }),
        ),
      ).toBeInstanceOf(NoOpenUnit);
    }),
  );
});
