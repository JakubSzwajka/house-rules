import { BookingsOperations } from "@example/bookings/contract";
import { BillingOperations } from "@example/billing/contract";
import { asSystem } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { Effect } from "effect";
import { defineFeature } from "@house-rules/application/contract";
export const cancelBooking = defineFeature("cancel_booking", {
  description: "Cancel your active booking and refund its paid payment.",
  title: "Cancel your active booking and refund its paid payment",
  permission: null,
  input: BookingsOperations.cancel.input,
  output: BookingsOperations.cancel.output,
  failure: Schema.Union([BookingsOperations.cancel.failure, BillingOperations.refund.failure]),
  edges: [BookingsOperations.cancel, asSystem(BillingOperations.refund, "refund after cancel")],
  handler: (input, { call: callNode }) =>
    Effect.gen(function* () {
      const booking = yield* callNode(BookingsOperations.cancel, input);
      yield* callNode(BillingOperations.refund, { bookingId: booking.id });
      return booking;
    }),
});
