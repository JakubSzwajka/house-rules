import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class IdentityStoreUnavailable extends Schema.TaggedError<IdentityStoreUnavailable>()(
  "IdentityStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Login bindings are unavailable. Try again shortly.";
  }
}
