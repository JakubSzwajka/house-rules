import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  kind: errorKind("forbidden"),
  entry: Schema.String,
  permission: Schema.TemplateLiteral([Schema.String, ":", Schema.String]),
  caller: Schema.Literals(["person", "system"]),
}) {
  override get message(): string {
    return `${this.caller} does not hold ${this.permission} for ${this.entry}`;
  }
}
export class ApprovalDenied extends Schema.TaggedError<ApprovalDenied>()("ApprovalDenied", {
  kind: errorKind("forbidden"),
  entry: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.reason}: ${this.entry}`;
  }
}
