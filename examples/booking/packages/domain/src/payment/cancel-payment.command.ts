import * as Domain from "@alchemy.run/domain";
import { Forbidden, PersonId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";
import { Amount } from "../booking/make-booking.command.ts";

export class PaymentCancelled extends Domain.Event("PaymentCancelled", { owner: PersonId }) {}

export class PaymentRefundStarted extends Domain.Event("PaymentRefundStarted", {
  owner: PersonId,
  chargeId: Schema.String,
  amount: Amount,
}) {}

export class CancelPayment extends Domain.Command("CancelPayment", {
  target: BookingId,
  middleware: [Session],
  events: [PaymentCancelled, PaymentRefundStarted],
  rejects: [Forbidden],
}) {}
