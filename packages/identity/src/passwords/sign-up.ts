import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { SignedIn } from "./signed-in.js";
import { AccountId } from "./account.js";
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
  { kind: errorKind("conflict") },
) {
  override get message() {
    return "This email is already registered.";
  }
}
