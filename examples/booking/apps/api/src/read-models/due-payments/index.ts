import { defineReadModel } from "@house-rules/application/contract";
import { BillingOperations } from "@example/billing/contract";
export const duePayments = defineReadModel("due_payments", {
  description: "Select due pending payments for maintenance.",
  permission: null,
  input: BillingOperations.duePayments.input,
  output: BillingOperations.duePayments.output,
  failure: BillingOperations.duePayments.failure,
  edges: [BillingOperations.duePayments],
  start: { kind: "system", reason: "nightly cleanup", startedBy: "schedule:nightly-cleanup" },
  handler: (input, { call }) => call(BillingOperations.duePayments, input),
});
