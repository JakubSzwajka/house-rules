import { BookingsNodes } from "@example/bookings/contract";
import { BillingNodes } from "@example/billing/contract";
import { defineNode, asSystem } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const cancelBooking = defineNode("cancel_booking", {
  description: "Cancel your active booking and refund its paid payment.",
  title: "Cancel your active booking and refund its paid payment",
  permission: null,
  input: BookingsNodes.cancel.input,
  output: BookingsNodes.cancel.output,
  failure: Schema.Union([BookingsNodes.cancel.failure, BillingNodes.refund.failure]),
  edges: [BookingsNodes.cancel, asSystem(BillingNodes.refund, "refund after cancel")],
});
