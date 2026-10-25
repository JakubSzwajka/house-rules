import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class MayUnavailable extends Schema.TaggedError<MayUnavailable>()("MayUnavailable", {
  kind: errorKind("unavailable"),
}) {
  override get message(): string {
    return "Try again shortly.";
  }
}
