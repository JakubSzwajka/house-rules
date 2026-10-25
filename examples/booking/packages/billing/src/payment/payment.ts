import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const PaymentStatus = Schema.Literals(["pending", "paid", "refunded", "expired"]);
export type PaymentStatus = typeof PaymentStatus.Type;
export const ChargeStatus = Schema.Literals(["pending", "paid"]);
export type ChargeStatus = typeof ChargeStatus.Type;
export const NewPayment = Schema.Struct({
  id: Schema.NonEmptyString,
  bookingId: Schema.NonEmptyString,
  amount: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type NewPayment = typeof NewPayment.Type;
export const Payment = Schema.Struct({
  ...NewPayment.fields,
  ownerId: Schema.String,
  status: PaymentStatus,
  createdAt: Schema.Int,
});
export type Payment = typeof Payment.Type;
export const RefundInput = Schema.Struct({ bookingId: Schema.NonEmptyString });
export type RefundInput = typeof RefundInput.Type;
export const ExpiredPayments = Schema.Struct({ expired: Schema.Int });
export type ExpiredPayments = typeof ExpiredPayments.Type;

export class PaymentNotFound extends Schema.TaggedError<PaymentNotFound>()("PaymentNotFound", {
  kind: errorKind("not_found"),
  bookingId: Schema.String,
}) {
  override get message() {
    return "No such payment.";
  }
}
export class PaymentAlreadyExists extends Schema.TaggedError<PaymentAlreadyExists>()(
  "PaymentAlreadyExists",
  {
    kind: errorKind("conflict"),
    id: Schema.String,
    bookingId: Schema.String,
  },
) {
  override get message() {
    return "Payment exists.";
  }
}
export class PaymentRefundDenied extends Schema.TaggedError<PaymentRefundDenied>()(
  "PaymentRefundDenied",
  {
    kind: errorKind("forbidden"),
    bookingId: Schema.String,
  },
) {
  override get message() {
    return "Refund refused.";
  }
}
export class PaymentNotPaid extends Schema.TaggedError<PaymentNotPaid>()("PaymentNotPaid", {
  kind: errorKind("conflict"),
  bookingId: Schema.String,
}) {
  override get message() {
    return "Payment is not paid.";
  }
}
export class PaymentCallerDenied extends Schema.TaggedError<PaymentCallerDenied>()(
  "PaymentCallerDenied",
  {
    kind: errorKind("forbidden"),
  },
) {
  override get message() {
    return "Caller refused.";
  }
}
export class PaymentStoreUnavailable extends Schema.TaggedError<PaymentStoreUnavailable>()(
  "PaymentStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return "Payments unavailable.";
  }
}
export class PaymentProviderFailed extends Schema.TaggedError<PaymentProviderFailed>()(
  "PaymentProviderFailed",
  {
    kind: errorKind("unavailable"),
    operation: Schema.Literals(["charge", "refund"]),
  },
) {
  override get message() {
    return "Provider unavailable.";
  }
}
