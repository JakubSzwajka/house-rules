import type { Caller } from "@house-rules/domain";
import { definePolicy } from "@house-rules/domain";

export { BillingPermissions } from "./permissions.ts";
import { BillingPermissions } from "./permissions.ts";
export const paymentPolicy = definePolicy({
  system: [BillingPermissions.refund],
  person: [],
}).withStates({
  pending: [],
  paid: [BillingPermissions.refund],
  refunded: [],
  expired: [],
});
export const paymentRelation = (caller: Caller): "system" | "person" => caller.kind;
export const pendingLifetimeMillis = 24 * 60 * 60 * 1000;
