import { bindOperation, type Binding } from "@house-rules/application";
import type { Actor, Caller, NoOpenUnit } from "@house-rules/domain";
import { Effect } from "effect";
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
import { initPaymentNode, refundNode, duePaymentsNode, expireOneNode } from "./operations.ts";

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
  readonly duePayments: (
    caller: Caller,
  ) => Effect.Effect<
    readonly { readonly paymentId: string }[],
    PaymentCallerDenied | PaymentStoreUnavailable
  >;
  readonly expireOne: (
    caller: Caller,
    paymentId: string,
  ) => Effect.Effect<ExpiredPayments, PaymentCallerDenied | PaymentStoreUnavailable | NoOpenUnit>;
};

export const bindBilling = (billing: Service): readonly Binding[] => [
  bindOperation(initPaymentNode, (input, { caller }) =>
    caller.kind === "person"
      ? billing.initPayment(caller.actor, input)
      : Effect.fail(new PaymentCallerDenied()),
  ),
  bindOperation(refundNode, ({ bookingId }, { caller }) => billing.refund(caller, bookingId)),
  bindOperation(duePaymentsNode, (_input, { caller }) => billing.duePayments(caller)),
  bindOperation(expireOneNode, ({ paymentId }, { caller }) => billing.expireOne(caller, paymentId)),
];
