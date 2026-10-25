import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Account, AccountId } from "./account.js";
import type { AccountStoreUnavailable } from "./store-unavailable.js";
import type { PasswordHash } from "./password-hash.js";

export type FailureLimit = Readonly<{ now: number; failures: number; lockUntil: number }>;

export type FailureCount = Readonly<{ failedAttempts: number; lockedUntil: number | null }>;

export type AdmitCheck = Readonly<{ now: number; password: PasswordHash }>;

export class AccountStore extends Context.Service<
  AccountStore,
  {
    readonly find: (id: AccountId) => Effect.Effect<Account | undefined, AccountStoreUnavailable>;
    readonly findByEmail: (
      email: string,
    ) => Effect.Effect<Account | undefined, AccountStoreUnavailable>;
    readonly insertIfFree: (
      account: Account,
    ) => Effect.Effect<boolean, AccountStoreUnavailable | NoOpenUnit>;
    readonly recordFailureIfUnlocked: (
      id: AccountId,
      limit: FailureLimit,
    ) => Effect.Effect<FailureCount | undefined, AccountStoreUnavailable | NoOpenUnit>;
    readonly admitIfUnlocked: (
      id: AccountId,
      check: AdmitCheck,
    ) => Effect.Effect<boolean, AccountStoreUnavailable | NoOpenUnit>;
    readonly setPassword: (
      id: AccountId,
      password: PasswordHash,
    ) => Effect.Effect<boolean, AccountStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/identity/AccountStore") {}
