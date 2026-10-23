import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class IdentityProviderInvalid extends Schema.TaggedError<IdentityProviderInvalid>()(
  "IdentityProviderInvalid",
  {
    kind: errorKind("unavailable"),
    option: Schema.String,
    message: Schema.String,
  },
) {}
