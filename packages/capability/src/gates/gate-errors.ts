import { Schema } from "effect";

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  capabilityName: Schema.String,
  permission: Schema.String,
}) {
  override get message(): string {
    return `Caller does not hold ${this.permission} for ${this.capabilityName}`;
  }
}

export class ApprovalDenied extends Schema.TaggedError<ApprovalDenied>()("ApprovalDenied", {
  capabilityName: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.reason}: ${this.capabilityName}`;
  }
}
