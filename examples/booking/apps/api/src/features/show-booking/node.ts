import { BookingsNodes } from "@example/bookings/contract";
import { defineNode } from "@house-rules/domain/contract";
export const showBooking = defineNode("show_booking", {
  description: "Read a booking you own.",
  title: "Read a booking you own",
  permission: null,
  input: BookingsNodes.get.input,
  output: BookingsNodes.get.output,
  failure: BookingsNodes.get.failure,
  readOnly: true,
  edges: [BookingsNodes.get],
});
