import { BookingsNodes } from "@example/bookings/contract";
import { BillingNodes } from "@example/billing/contract";
import { bindNode } from "@house-rules/application";
import { Effect } from "effect";
import { makeBooking } from "./node.ts";
export const makeBookingBinding = bindNode(makeBooking, (input, { call: callNode }) =>
  Effect.gen(function* () {
    const { paymentId, amount, ...bookingInput } = input;
    const booking = yield* callNode(BookingsNodes.book, bookingInput);
    yield* callNode(BillingNodes.initPayment, { id: paymentId, bookingId: booking.id, amount });
    return booking;
  }),
);
