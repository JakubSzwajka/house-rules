import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class CallInvalid extends Schema.TaggedError<CallInvalid>()("CallInvalid", {
  kind: errorKind("unavailable"),
  callable: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
