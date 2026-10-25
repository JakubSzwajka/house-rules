import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { PasswordHash } from "./password-hash.js";

export const AccountId = Schema.NonEmptyString.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120));

export const Account = Schema.Struct({
  id: AccountId,
  email: Schema.String,
  displayName: Schema.String,
  password: PasswordHash,
  failedAttempts: Schema.Int,
  lockedUntil: Schema.NullOr(Schema.Int),
  createdAt: Schema.Int,
});
export type Account = typeof Account.Type;

export class AccountInputInvalid extends Schema.TaggedError<AccountInputInvalid>()(
  "AccountInputInvalid",
  { kind: errorKind("invalid"), message: Schema.String },
) {}
