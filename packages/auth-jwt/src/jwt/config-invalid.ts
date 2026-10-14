import { Schema } from "effect";

export class AuthJwtConfigInvalid extends Schema.TaggedError<AuthJwtConfigInvalid>()(
  "AuthJwtConfigInvalid",
  {
    option: Schema.String,
    message: Schema.String,
  },
) {}
