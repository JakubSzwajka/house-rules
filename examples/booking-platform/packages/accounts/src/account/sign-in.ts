import { defineContract } from "@house-rules/application/contract";
import { UnitOfWorkFailed } from "@house-rules/domain/contract";
import { type Result, Schema } from "effect";
import { SignedIn } from "../token/signed-in.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";

export const SignInInput = Schema.Struct({ email: Schema.String, password: Schema.String });
export type SignInInput = typeof SignInInput.Type;

export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  {},
) {}

export type SignInOutcome = Result.Result<SignedIn, InvalidCredentials>;

export const signInContract = defineContract("sign_in", {
  description: "Sign in with an email and a password and get a bearer token.",
  input: SignInInput,
  output: SignedIn,
  failure: Schema.Union([InvalidCredentials, AccountStoreUnavailable, UnitOfWorkFailed]),
  permission: "public",
});
