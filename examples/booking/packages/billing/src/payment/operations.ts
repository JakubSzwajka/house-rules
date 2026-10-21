import { defineOperation } from "@house-rules/domain/contract";
import { NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  Payment,
  NewPayment,
  RefundInput,
  ExpiredPayments,
  PaymentAlreadyExists,
  PaymentNotFound,
  PaymentRefundDenied,
  PaymentNotPaid,
  PaymentCallerDenied,
  PaymentStoreUnavailable,
  PaymentProviderFailed,
} from "./payment.ts";
import { BillingPermissions } from "./permissions.ts";

export const initPaymentNode = defineOperation("Billing.initPayment", {
  description: "Charge a new booking through the demo payment provider.",
  input: NewPayment,
  output: Payment,
  failure: Schema.Union([
    PaymentAlreadyExists,
    PaymentNotFound,
    PaymentCallerDenied,
    PaymentStoreUnavailable,
    PaymentProviderFailed,
  ]),
  permission: BillingPermissions.charge,

  transactional: true,
});
export const refundNode = defineOperation("Billing.refund", {
  description: "Refund a paid payment as the system.",
  input: RefundInput,
  output: Payment,
  failure: Schema.Union([
    PaymentNotFound,
    PaymentRefundDenied,
    PaymentNotPaid,
    PaymentStoreUnavailable,
    PaymentProviderFailed,
  ]),
  permission: BillingPermissions.refund,

  transactional: true,
  destructive: true,
});
export const expirePendingNode = defineOperation("Billing.expirePending", {
  description: "Expire pending payments older than 24 hours.",
  input: NoInput,
  output: ExpiredPayments,
  failure: Schema.Union([PaymentCallerDenied, PaymentStoreUnavailable]),
  permission: BillingPermissions.expire,

  transactional: true,
});

export const BillingOperations = {
  initPayment: initPaymentNode,
  refund: refundNode,
  expirePending: expirePendingNode,
} as const;
