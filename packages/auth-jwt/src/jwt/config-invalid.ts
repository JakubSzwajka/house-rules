import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class AuthJwtConfigInvalid extends Schema.TaggedError<AuthJwtConfigInvalid>()(
  "AuthJwtConfigInvalid",
  {
    kind: errorKind("unavailable"),
    option: Schema.String,
    message: Schema.String,
  },
) {}
