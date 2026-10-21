import type { Caller } from "@house-rules/domain";
import { type Actor, defineModule, type NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect } from "effect";
import { PaymentStore } from "./storage.ts";
import { PaymentProvider } from "./payment/payment-provider.ts";
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
} from "./payment/payment.ts";
import {
  paymentPolicy,
  paymentRelation,
  BillingPermissions,
  pendingLifetimeMillis,
} from "./payment/payment-policy.ts";

export class Billing extends defineModule<
  Billing,
  {
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
  }
>()("@example/api/modules/billing/Billing", {
  make: Effect.gen(function* () {
    const store = yield* PaymentStore;
    const provider = yield* PaymentProvider;
    const required = UnitOfWork.required;
    return {
      initPayment: Effect.fn("Billing.initPayment")(function* (actor: Actor, input: NewPayment) {
        yield* required;
        const payment: Payment = {
          ...input,
          ownerId: actor.id,
          status: "pending",
          createdAt: yield* Clock.currentTimeMillis,
        };
        if (!(yield* store.insert(payment)))
          return yield* new PaymentAlreadyExists({ id: input.id, bookingId: input.bookingId });
        const status = yield* provider.charge(payment);
        if (status === "paid") {
          if (!(yield* store.transition(payment.id, "pending", "paid")))
            return yield* new PaymentNotFound({ bookingId: input.bookingId });
        }
        return { ...payment, status };
      }),
      refund: Effect.fn("Billing.refund")(function* (caller: Caller, bookingId: string) {
        yield* required;
        if (caller.kind !== "system") return yield* new PaymentRefundDenied({ bookingId });
        const payment = yield* store.findByBookingId(bookingId);
        if (payment === undefined) return yield* new PaymentNotFound({ bookingId });
        if (
          !paymentPolicy.allows(paymentRelation(caller), payment.status, BillingPermissions.refund)
        )
          return yield* new PaymentNotPaid({ bookingId });
        if (!(yield* store.transition(payment.id, "paid", "refunded")))
          return yield* new PaymentNotPaid({ bookingId });
        yield* provider.refund(payment);
        return { ...payment, status: "refunded" as const };
      }),
      expirePending: Effect.fn("Billing.expirePending")(function* (caller: Caller) {
        yield* required;
        if (caller.kind !== "system") return yield* new PaymentCallerDenied();
        const now = yield* Clock.currentTimeMillis;
        return { expired: yield* store.expireBefore(now - pendingLifetimeMillis) };
      }),
    };
  }),
}) {}
