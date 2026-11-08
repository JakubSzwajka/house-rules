import * as Domain from "@alchemy.run/domain";
import { Forbidden, PersonId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";
import { Amount } from "../booking/make-booking.command.ts";

export const PAYMENT_WINDOW_HOURS = 24;

export class PaymentOpened extends Domain.Event("PaymentOpened", {
  owner: PersonId,
  amount: Amount,
  expiresAt: Schema.String,
}) {}

export class OpenPayment extends Domain.Command("OpenPayment", {
  target: BookingId,
  middleware: [Session],
  input: { owner: PersonId, amount: Amount },
  events: [PaymentOpened],
  rejects: [Forbidden],
}) {}
