import { defineOperation, NoInput, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class AuditUnavailable extends Schema.TaggedError<AuditUnavailable>()("AuditUnavailable", {
  kind: errorKind("unavailable"),
  message: Schema.tag("Audit is unavailable."),
}) {}
export const AuditEntry = Schema.Struct({
  at: Schema.Int,
  who: Schema.NullOr(Schema.String),
  feature: Schema.String,
  outcome: Schema.String,
  requestId: Schema.NullOr(Schema.String),
  ms: Schema.Finite,
  kind: Schema.NullOr(Schema.String),
});
const recent = defineOperation("AuditTrail.recent", {
  description: "Read all recent feature audit rows as a global administrator.",
  input: NoInput,
  output: Schema.Array(AuditEntry),
  failure: AuditUnavailable,
  permission: "audit:read",
  readOnly: true,
});
const mine = defineOperation("AuditTrail.mine", {
  description: "Read only your own recent feature audit rows.",
  input: NoInput,
  output: Schema.Array(AuditEntry),
  failure: AuditUnavailable,
  permission: null,
  readOnly: true,
});
export const AuditTrailOperations = { recent, mine } as const;
