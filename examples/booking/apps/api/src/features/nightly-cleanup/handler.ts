import { BillingNodes } from "@example/billing/contract";
import { bindNode } from "@house-rules/application";
import { nightlyCleanupNode } from "./node.ts";
export const nightlyCleanupNodeBinding = bindNode(nightlyCleanupNode, (input, { call: callNode }) =>
  callNode(BillingNodes.expirePending, input),
);
