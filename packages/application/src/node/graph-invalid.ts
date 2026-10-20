import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class GraphInvalid extends Schema.TaggedError<GraphInvalid>()("GraphInvalid", {
  kind: errorKind("unavailable"),
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
