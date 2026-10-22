import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class AccountStoreUnavailable extends Schema.TaggedError<AccountStoreUnavailable>()(
  "AccountStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message() {
    return "Accounts are unavailable.";
  }
}
