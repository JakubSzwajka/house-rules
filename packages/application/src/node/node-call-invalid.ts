import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class NodeCallInvalid extends Schema.TaggedError<NodeCallInvalid>()("NodeCallInvalid", {
  kind: errorKind("unavailable"),
  node: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
