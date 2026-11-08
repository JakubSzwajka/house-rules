import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";
import { Amount } from "../booking/make-booking.command.ts";

export class ChargeDeclined extends Schema.TaggedError<ChargeDeclined>()("ChargeDeclined", {
  reason: Schema.String,
}) {}

export class PaymentProvider extends Domain.ExternalSystem("PaymentProvider", {
  charge: {
    args: { paymentId: BookingId, amount: Amount },
    success: { chargeId: Schema.String },
    error: ChargeDeclined,
  },
  refund: {
    args: { chargeId: Schema.String, amount: Amount },
    success: { refundId: Schema.String },
  },
}) {}
