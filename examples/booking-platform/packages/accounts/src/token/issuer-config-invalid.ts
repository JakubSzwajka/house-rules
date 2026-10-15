import { Schema } from "effect";

export class AccountsIssuerConfigInvalid extends Schema.TaggedError<AccountsIssuerConfigInvalid>()(
  "AccountsIssuerConfigInvalid",
  { option: Schema.String, message: Schema.String },
) {}
