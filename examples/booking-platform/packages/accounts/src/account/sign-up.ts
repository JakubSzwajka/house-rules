import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";
import { SignedIn } from "../token/signed-in.js";
import { AccountId, AccountInputInvalid } from "./account.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";

export const SignUpInput = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  displayName: Schema.String,
});
export type SignUpInput = typeof SignUpInput.Type;

export const SignedUp = Schema.Struct({ accountId: AccountId, ...SignedIn.fields });
export type SignedUp = typeof SignedUp.Type;

export class AccountEmailTaken extends Schema.TaggedError<AccountEmailTaken>()(
  "AccountEmailTaken",
  {},
) {}

export const signUpContract = defineContract("sign_up", {
  description:
    "Create an account with an email, a password and a display name, and get a bearer token.",
  input: SignUpInput,
  output: SignedUp,
  failure: Schema.Union([AccountInputInvalid, AccountEmailTaken, AccountStoreUnavailable]),
  permission: "public",
  transactional: true,
});
