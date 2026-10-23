import { defineFeature } from "@house-rules/application/contract";
import { BillingOperations } from "@example/billing/contract";
export const expirePayment = defineFeature("expire_payment", {
  description: "Expire one due payment, safely repeated.",
  permission: null,
  input: BillingOperations.expireOne.input,
  output: BillingOperations.expireOne.output,
  failure: BillingOperations.expireOne.failure,
  edges: [BillingOperations.expireOne],
  start: { kind: "system", reason: "nightly cleanup", startedBy: "schedule:nightly-cleanup" },
  handler: (input, { call }) => call(BillingOperations.expireOne, input),
});
