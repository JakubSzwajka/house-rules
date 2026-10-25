import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { AccountInputInvalid } from "./account.js";
import { SignUpInput, SignedUp, AccountEmailTaken } from "./sign-up.js";
import { SignInInput, SignInAnswer } from "./sign-in.js";
import { ChangePasswordInput } from "./change-password.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";
import { PasswordsUnavailable } from "./provider-unavailable.js";
const signUp = defineOperation("Identity.signUp", {
  description: "Create an account and issue a session.",
  input: SignUpInput,
  output: SignedUp,
  failure: Schema.Union([
    AccountInputInvalid,
    AccountEmailTaken,
    AccountStoreUnavailable,
    PasswordsUnavailable,
  ]),
  permission: "identity:create",
  transactional: true,
});
const signIn = defineOperation("Identity.signIn", {
  description: "Check credentials, counting refused attempts, and issue a session.",
  input: SignInInput,
  output: SignInAnswer,
  failure: Schema.Union([AccountStoreUnavailable, PasswordsUnavailable]),
  permission: "identity:sign-in",
  transactional: true,
});
const changePassword = defineOperation("Identity.changePassword", {
  description: "Change the caller's password using the current password.",
  input: ChangePasswordInput,
  output: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("PasswordChanged") }),
    Schema.Struct({ _tag: Schema.Literal("InvalidCredentials") }),
  ]),
  failure: Schema.Union([AccountInputInvalid, AccountStoreUnavailable, PasswordsUnavailable]),
  permission: "identity:update",
  transactional: true,
});
export const PasswordOperations = { signUp, signIn, changePassword } as const;
