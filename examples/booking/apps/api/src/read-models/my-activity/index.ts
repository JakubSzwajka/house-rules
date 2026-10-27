import { defineReadModel } from "@house-rules/application/contract";
import { AuditTrailOperations } from "../../projections/audit-trail/contract.ts";
const operation = AuditTrailOperations.mine;
export const myActivity = defineReadModel("my_activity", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  handler: (input, { call }) => call(operation, input),
});
