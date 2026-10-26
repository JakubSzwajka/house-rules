import { AuditTrailOperations } from "../../projections/audit-trail/contract.ts";
import { defineFeature } from "@house-rules/application/contract";
const operation = AuditTrailOperations.recent;
export const recentAudit = defineFeature("recent_audit", {
  description: "Read your own recent audit rows.",
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  permission: null,
  edges: [operation],
  flags: { readOnly: true },
  handler: (input, { call }) => call(operation, input),
});
