import { BillingNodes } from "@example/billing/contract";
import { defineNode } from "@house-rules/domain/contract";
export const nightlyCleanupNode = defineNode("nightly_cleanup", {
  description: "Expire pending payments strictly older than one day.",
  title: "Expire pending payments strictly older than one day",
  permission: null,
  input: BillingNodes.expirePending.input,
  output: BillingNodes.expirePending.output,
  failure: BillingNodes.expirePending.failure,
  edges: [BillingNodes.expirePending],
});
