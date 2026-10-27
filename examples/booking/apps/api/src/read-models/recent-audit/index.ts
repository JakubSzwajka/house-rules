import { AuditTrailOperations } from "../../projections/audit-trail/contract.ts";
import { defineReadModel } from "@house-rules/application/contract";
const operation = AuditTrailOperations.recent;
export const recentAudit = defineReadModel("recent_audit", {
  description: "Read your own recent audit rows.",
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  permission: null,
  edges: [operation],
  handler: (input, { call }) => call(operation, input),
});
