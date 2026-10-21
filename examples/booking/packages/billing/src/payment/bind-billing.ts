import { bindOperation, type Binding } from "@house-rules/application";
import type { Actor, Caller, NoOpenUnit } from "@house-rules/domain";
import { Effect } from "effect";
import { PaymentProvider } from "./payment-provider.ts";
import {
  type Payment,
  type NewPayment,
  type ExpiredPayments,
  PaymentAlreadyExists,
  PaymentNotFound,
  PaymentRefundDenied,
  PaymentNotPaid,
  PaymentCallerDenied,
  type PaymentStoreUnavailable,
  type PaymentProviderFailed,
} from "./payment.ts";
import {
  paymentPolicy,
  paymentRelation,
  BillingPermissions,
  pendingLifetimeMillis,
} from "./payment-policy.ts";
import { initPaymentNode, refundNode, expirePendingNode } from "./operations.ts";

type Service = {
  readonly initPayment: (
    actor: Actor,
    input: NewPayment,
  ) => Effect.Effect<
    Payment,
    | PaymentAlreadyExists
    | PaymentNotFound
    | PaymentStoreUnavailable
    | PaymentProviderFailed
    | NoOpenUnit
  >;
  readonly refund: (
    caller: Caller,
    bookingId: string,
  ) => Effect.Effect<
    Payment,
    | PaymentNotFound
    | PaymentRefundDenied
    | PaymentNotPaid
    | PaymentStoreUnavailable
    | PaymentProviderFailed
    | NoOpenUnit
  >;
  readonly expirePending: (
    caller: Caller,
  ) => Effect.Effect<ExpiredPayments, PaymentCallerDenied | PaymentStoreUnavailable | NoOpenUnit>;
};

export const bindBilling = (billing: Service): readonly Binding[] => [
  bindOperation(initPaymentNode, (input, { caller }) =>
    caller.kind === "person"
      ? billing.initPayment(caller.actor, input)
      : Effect.fail(new PaymentCallerDenied()),
  ),
  bindOperation(refundNode, ({ bookingId }, { caller }) => billing.refund(caller, bookingId)),
  bindOperation(expirePendingNode, (_input, { caller }) => billing.expirePending(caller)),
];
