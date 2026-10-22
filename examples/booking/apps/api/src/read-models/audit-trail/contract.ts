import { defineOperation, NoInput, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export class AuditUnavailable extends Schema.TaggedError<AuditUnavailable>()("AuditUnavailable", {
  kind: errorKind("unavailable"),
  message: Schema.tag("Audit is unavailable."),
}) {}
export const AuditEntry = Schema.Struct({
  feature: Schema.String,
  outcome: Schema.String,
  requestId: Schema.NullOr(Schema.String),
  ms: Schema.Finite,
});
const recent = defineOperation("AuditTrail.recent", {
  description: "Read your own recent feature audit rows.",
  input: NoInput,
  output: Schema.Array(AuditEntry),
  failure: AuditUnavailable,
  permission: "audit:read",
  readOnly: true,
});
export const AuditTrailOperations = { recent } as const;
