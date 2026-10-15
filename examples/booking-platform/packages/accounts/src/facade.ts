import { defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import type { AccountInputInvalid } from "./account/account.js";
import { type ChangePassword, makeAccounts } from "./account/accounts.js";
import type { ChangePasswordOutcome } from "./account/change-password.js";
import type { SignInInput, SignInOutcome } from "./account/sign-in.js";
import type { AccountEmailTaken, SignedUp, SignUpInput } from "./account/sign-up.js";
import type { AccountStoreUnavailable } from "./account/store-unavailable.js";
import { memoryAccountStore } from "./adapters/memory/account.js";
import { postgresAccountStore } from "./adapters/postgres/account.js";
import { AccountStore } from "./storage.js";
import { AccountsIssuer } from "./token/accounts-issuer.js";

export class Accounts extends defineModule<
  Accounts,
  {
    readonly signUp: (
      input: SignUpInput,
    ) => Effect.Effect<
      SignedUp,
      AccountInputInvalid | AccountEmailTaken | AccountStoreUnavailable | NoOpenUnit
    >;
    readonly signIn: (
      input: SignInInput,
    ) => Effect.Effect<SignInOutcome, AccountStoreUnavailable | NoOpenUnit>;
    readonly changePassword: (
      input: ChangePassword,
    ) => Effect.Effect<
      ChangePasswordOutcome,
      AccountInputInvalid | AccountStoreUnavailable | NoOpenUnit
    >;
  }
>()("@example/accounts/Accounts", {
  make: Effect.gen(function* accountsLayer() {
    return makeAccounts(yield* AccountStore, yield* AccountsIssuer);
  }),
}) {
  static readonly layerMemory = this.layer.pipe(Layer.provide(memoryAccountStore()));

  static readonly layerPostgres = this.layer.pipe(Layer.provide(postgresAccountStore));
}
