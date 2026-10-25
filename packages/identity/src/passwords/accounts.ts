import { UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Result, Schema } from "effect";
import { Hex } from "effect/encoding";
import {
  hashPassword,
  needsRehash,
  PasswordLength,
  passwordFitsPolicy,
  spendDummyWork,
  verifyPassword,
} from "./password.js";
import type { AccountStore } from "./account-store.js";
import type { PasswordIssuerService } from "./accounts-issuer.js";
import { type Account, AccountId, AccountInputInvalid, DisplayName } from "./account.js";
import type { ChangePasswordOutcome } from "./change-password.js";
import { normaliseEmail } from "./email.js";
import { InvalidCredentials, type SignInInput, type SignInOutcome } from "./sign-in.js";
import { AccountEmailTaken, type SignUpInput } from "./sign-up.js";

export const Lockout = { failures: 5, minutes: 15 } as const;

export type ChangePassword = Readonly<{ accountId: AccountId; current: string; next: string }>;

const invalid = (message: string) => new AccountInputInvalid({ message });
const badEmail = () => invalid("Enter a valid email address.");
const badPassword = () =>
  invalid(`A password has ${PasswordLength.min} to ${PasswordLength.max} characters.`);
const badName = () => invalid("A display name has 1 to 120 characters.");

const refused = (): SignInOutcome => Result.fail(new InvalidCredentials());
const refusedChange = (): ChangePasswordOutcome => Result.fail(new InvalidCredentials());
const noAccount = AccountId.make("no-account");

export const makeAccounts = (store: AccountStore["Service"], issuer: PasswordIssuerService) => {
  const decodeName = Schema.decodeUnknownEffect(DisplayName);
  const newId = Effect.sync(() =>
    AccountId.make(Hex.encode(globalThis.crypto.getRandomValues(new Uint8Array(16)))),
  );
  const failureLimit = (now: number) => ({
    now,
    failures: Lockout.failures,
    lockUntil: now + Lockout.minutes * 60_000,
  });
  const spendUnknownAccountWork = Effect.fn("Accounts.unknownAccount")(function* (
    password: string,
  ) {
    // An unknown account runs the same hash and the same conditional write as a known one.
    yield* spendDummyWork(password);
    yield* store.recordFailureIfUnlocked(noAccount, failureLimit(yield* Clock.currentTimeMillis));
  });
  const authenticate = Effect.fn("Accounts.authenticate")(function* (
    account: Account,
    password: string,
  ) {
    const matches = yield* verifyPassword(password, account.password);
    const now = yield* Clock.currentTimeMillis;
    if (!matches) {
      const counted = yield* store.recordFailureIfUnlocked(account.id, failureLimit(now));
      if (counted !== undefined && counted.lockedUntil !== null) {
        yield* Effect.logWarning("Account locked after repeated failed passwords.").pipe(
          Effect.annotateLogs({ accountId: account.id }),
        );
      }
      return false;
    }
    // The lock is checked by the write, not by the account read earlier, so a fresh lock wins.
    const admitted = yield* store.admitIfUnlocked(account.id, { now, password: account.password });
    if (!admitted) {
      yield* Effect.logInfo(
        "Refused a correct password: the account is locked or its password changed meanwhile.",
      ).pipe(Effect.annotateLogs({ accountId: account.id }));
    }
    return admitted;
  });
  return {
    signUp: Effect.fn("Identity.signUp")(function* (input: SignUpInput) {
      yield* UnitOfWork.required;
      const email = normaliseEmail(input.email);
      if (email === undefined) return yield* badEmail();
      if (!passwordFitsPolicy(input.password)) return yield* badPassword();
      const displayName = yield* decodeName(input.displayName).pipe(Effect.mapError(badName));
      const account: Account = {
        id: yield* newId,
        email,
        displayName,
        password: yield* hashPassword(input.password),
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: yield* Clock.currentTimeMillis,
      };
      if (!(yield* store.insertIfFree(account))) return yield* new AccountEmailTaken();
      // Signed inside the open unit: a rollback fails the call, so the token never goes out.
      const signedIn = yield* issuer.sign(account.id, {
        name: account.displayName,
        email: account.email,
      });
      return { accountId: account.id, ...signedIn };
    }),
    signIn: Effect.fn("Identity.signIn")(function* (input: SignInInput) {
      yield* UnitOfWork.required;
      const email = normaliseEmail(input.email);
      const account = email === undefined ? undefined : yield* store.findByEmail(email);
      if (account === undefined) {
        yield* spendUnknownAccountWork(input.password);
        return refused();
      }
      if (!(yield* authenticate(account, input.password))) return refused();
      if (needsRehash(account.password)) {
        yield* store.setPassword(account.id, yield* hashPassword(input.password));
      }
      const signedIn: SignInOutcome = Result.succeed(
        yield* issuer.sign(account.id, { name: account.displayName, email: account.email }),
      );
      return signedIn;
    }),
    changePassword: Effect.fn("Identity.changePassword")(function* (input: ChangePassword) {
      yield* UnitOfWork.required;
      if (!passwordFitsPolicy(input.next)) return yield* badPassword();
      const account = yield* store.find(input.accountId);
      if (account === undefined) {
        yield* spendUnknownAccountWork(input.current);
        return refusedChange();
      }
      if (!(yield* authenticate(account, input.current))) return refusedChange();
      yield* store.setPassword(account.id, yield* hashPassword(input.next));
      const changed: ChangePasswordOutcome = Result.void;
      return changed;
    }),
  };
};

export type PasswordMethods = {
  [K in keyof ReturnType<typeof makeAccounts>]: (
    ...args: Parameters<ReturnType<typeof makeAccounts>[K]>
  ) => Effect.Effect<
    Effect.Success<ReturnType<ReturnType<typeof makeAccounts>[K]>>,
    | Effect.Error<ReturnType<ReturnType<typeof makeAccounts>[K]>>
    | import("./provider-unavailable.js").PasswordsUnavailable
  >;
};
