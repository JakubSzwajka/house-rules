import { BookingsOperations } from "@example/bookings/contract";
import { defineFeature } from "@house-rules/application/contract";
export const partnerBooking = defineFeature("book_for_partner", {
  description: "Create a partner booking without charging a payment.",
  title: "Create a partner booking without charging a payment",
  permission: null,
  input: BookingsOperations.book.input,
  output: BookingsOperations.book.output,
  failure: BookingsOperations.book.failure,
  edges: [BookingsOperations.book],
  handler: (input, { call }) => call(BookingsOperations.book, input),
});
