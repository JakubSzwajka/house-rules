import * as Domain from "@alchemy.run/domain";
import { PersonId, requirePermission } from "@house-rules/stack";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";
import { Amount } from "../booking/make-booking.command.ts";
import { PaymentPermissions } from "../permissions.ts";
import { CancelPayment, PaymentCancelled, PaymentRefundStarted } from "./cancel-payment.command.ts";
import { ExpirePayment, PaymentExpired } from "./expire-payment.command.ts";
import { OpenPayment, PAYMENT_WINDOW_HOURS, PaymentOpened } from "./open-payment.command.ts";
import { PaymentPaid, RecordCharge } from "./record-charge.command.ts";
import { PaymentRefunded, RecordRefund } from "./record-refund.command.ts";

export const PaymentStatus = Schema.Literals([
  "pending",
  "paid",
  "refunding",
  "refunded",
  "expired",
  "cancelled",
]);
export type PaymentStatus = typeof PaymentStatus.Type;

const Opened = Schema.TaggedStruct("Opened", {
  owner: PersonId,
  amount: Amount,
  status: PaymentStatus,
  chargeId: Schema.NullOr(Schema.String),
});

export const PaymentState = Schema.Union([Schema.TaggedStruct("Unopened", {}), Opened]);
export type PaymentState = typeof PaymentState.Type;

const settle = requirePermission(PaymentPermissions.settle);

const moveTo = (status: PaymentStatus, chargeId?: string) => (s: PaymentState) =>
  s._tag === "Opened" ? { ...s, status, chargeId: chargeId ?? s.chargeId } : s;

export class Payment extends Domain.Aggregate("Payment", {
  id: BookingId,
  state: PaymentState,
  initial: { _tag: "Unopened" },
  commands: [OpenPayment, RecordCharge, ExpirePayment, CancelPayment, RecordRefund],
  decide: {
    OpenPayment: Effect.fn(function* (payment, cmd, { now }) {
      yield* settle;
      if (payment._tag !== "Unopened") return [];
      const expiresAt = DateTime.formatIso(DateTime.add(now, { hours: PAYMENT_WINDOW_HOURS }));
      return [new PaymentOpened({ owner: cmd.owner, amount: cmd.amount, expiresAt })];
    }),
    RecordCharge: Effect.fn(function* (payment, cmd) {
      yield* settle;
      if (payment._tag !== "Opened" || payment.status !== "pending") return [];
      return [new PaymentPaid({ owner: payment.owner, chargeId: cmd.chargeId })];
    }),
    ExpirePayment: (payment) =>
      payment._tag === "Opened" && payment.status === "pending"
        ? [new PaymentExpired({ owner: payment.owner })]
        : [],
    CancelPayment: Effect.fn(function* (payment) {
      yield* settle;
      if (payment._tag !== "Opened") return [];
      if (payment.status === "pending") return [new PaymentCancelled({ owner: payment.owner })];
      if (payment.status !== "paid" || payment.chargeId === null) return [];
      return [
        new PaymentRefundStarted({
          owner: payment.owner,
          chargeId: payment.chargeId,
          amount: payment.amount,
        }),
      ];
    }),
    RecordRefund: Effect.fn(function* (payment, cmd) {
      yield* settle;
      if (payment._tag !== "Opened" || payment.status !== "refunding") return [];
      return [new PaymentRefunded({ owner: payment.owner, refundId: cmd.refundId })];
    }),
  },
  evolve: {
    PaymentOpened: (_, e) => ({
      _tag: "Opened" as const,
      owner: e.owner,
      amount: e.amount,
      status: "pending" as const,
      chargeId: null,
    }),
    PaymentPaid: (s, e) => moveTo("paid", e.chargeId)(s),
    PaymentExpired: (s) => moveTo("expired")(s),
    PaymentCancelled: (s) => moveTo("cancelled")(s),
    PaymentRefundStarted: (s) => moveTo("refunding")(s),
    PaymentRefunded: (s) => moveTo("refunded")(s),
  },
}) {}
