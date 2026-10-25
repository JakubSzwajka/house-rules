import { BookingsOperations, NewBooking } from "@example/bookings/contract";
import { BillingOperations, NewPayment } from "@example/billing/contract";
import { Effect, Schema } from "effect";
import { defineFeature } from "@house-rules/application/contract";
export const makeBooking = defineFeature("make_booking", {
  description: "Create a booking and charge its payment.",
  title: "Create a booking and charge its payment",
  permission: null,
  input: Schema.Struct({
    ...NewBooking.fields,
    paymentId: NewPayment.fields.id,
    amount: NewPayment.fields.amount,
  }),
  output: BookingsOperations.book.output,
  failure: Schema.Union([BookingsOperations.book.failure, BillingOperations.initPayment.failure]),
  edges: [BookingsOperations.book, BillingOperations.initPayment],
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const { paymentId, amount, ...bookingInput } = input;
      const booking = yield* call(BookingsOperations.book, bookingInput);
      yield* call(BillingOperations.initPayment, {
        id: paymentId,
        bookingId: booking.id,
        amount,
      });
      return booking;
    }),
});
