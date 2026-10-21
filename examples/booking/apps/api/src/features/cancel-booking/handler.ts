import { BookingsNodes } from "@example/bookings/contract";
import { BillingNodes } from "@example/billing/contract";
import { bindNode } from "@house-rules/application";
import { Effect } from "effect";
import { cancelBooking } from "./node.ts";
export const cancelBookingBinding = bindNode(cancelBooking, (input, { call: callNode }) =>
  Effect.gen(function* () {
    const booking = yield* callNode(BookingsNodes.cancel, input);
    yield* callNode(BillingNodes.refund, { bookingId: booking.id });
    return booking;
  }),
);
