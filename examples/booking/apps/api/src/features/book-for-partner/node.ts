import { BookingsNodes } from "@example/bookings/contract";
import { defineNode } from "@house-rules/domain/contract";
export const partnerBooking = defineNode("book_for_partner", {
  description: "Create a partner booking without charging a payment.",
  title: "Create a partner booking without charging a payment",
  permission: null,
  input: BookingsNodes.book.input,
  output: BookingsNodes.book.output,
  failure: BookingsNodes.book.failure,
  edges: [BookingsNodes.book],
});
