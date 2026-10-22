import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class PasswordsUnavailable extends Schema.TaggedError<PasswordsUnavailable>()(
  "PasswordsUnavailable",
  { kind: errorKind("unavailable") },
) {
  override get message() {
    return "Password sign-in is not configured.";
  }
}
