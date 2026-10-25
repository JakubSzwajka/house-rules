import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class PasswordIssuerConfigInvalid extends Schema.TaggedError<PasswordIssuerConfigInvalid>()(
  "PasswordIssuerConfigInvalid",
  { kind: errorKind("unavailable"), option: Schema.String, message: Schema.String },
) {}
