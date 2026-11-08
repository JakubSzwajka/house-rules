import * as Domain from "@alchemy.run/domain";
import { PersonId } from "@house-rules/stack";
import { BookingId } from "../booking/booking.id.ts";

export class PaymentExpired extends Domain.Event("PaymentExpired", { owner: PersonId }) {}

export class ExpirePayment extends Domain.Command("ExpirePayment", {
  target: BookingId,
  events: [PaymentExpired],
}) {}
