import { BookingsNodes, NewBooking } from "@example/bookings/contract";
import { BillingNodes, NewPayment } from "@example/billing/contract";
import { defineNode } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const makeBooking = defineNode("make_booking", {
  description: "Create a booking and charge its payment.",
  title: "Create a booking and charge its payment",
  permission: null,
  input: Schema.Struct({
    ...NewBooking.fields,
    paymentId: NewPayment.fields.id,
    amount: NewPayment.fields.amount,
  }),
  output: BookingsNodes.book.output,
  failure: Schema.Union([BookingsNodes.book.failure, BillingNodes.initPayment.failure]),
  edges: [BookingsNodes.book, BillingNodes.initPayment],
});
