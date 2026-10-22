import { type Result, Schema } from "effect";
import { SignedIn } from "./signed-in.js";

export const SignInInput = Schema.Struct({ email: Schema.String, password: Schema.String });
export type SignInInput = typeof SignInInput.Type;
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  {},
) {}
export type SignInOutcome = Result.Result<SignedIn, InvalidCredentials>;
export const SignInAnswer = Schema.Union([
  SignedIn,
  Schema.Struct({ _tag: Schema.Literal("InvalidCredentials") }),
]);
