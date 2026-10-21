import { BookingsOperations } from "@example/bookings/contract";
import { defineFeature } from "@house-rules/application/contract";
export const showBooking = defineFeature("show_booking", {
  description: "Read a booking you own.",
  title: "Read a booking you own",
  permission: null,
  input: BookingsOperations.get.input,
  output: BookingsOperations.get.output,
  failure: BookingsOperations.get.failure,
  flags: { readOnly: true },
  edges: [BookingsOperations.get],
  handler: (input, { call: callNode }) => callNode(BookingsOperations.get, input),
});
