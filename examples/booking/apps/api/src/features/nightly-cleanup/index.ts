import { BillingOperations } from "@example/billing/contract";
import { defineFeature } from "@house-rules/application/contract";
export const nightlyCleanup = defineFeature("nightly_cleanup", {
  description: "Expire pending payments strictly older than one day.",
  title: "Expire pending payments strictly older than one day",
  permission: null,
  input: BillingOperations.expirePending.input,
  output: BillingOperations.expirePending.output,
  failure: BillingOperations.expirePending.failure,
  edges: [BillingOperations.expirePending],
  start: { kind: "system", reason: "nightly cleanup", startedBy: "schedule:nightly_cleanup" },
  handler: (input, { call: callNode }) => callNode(BillingOperations.expirePending, input),
});
