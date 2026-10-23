import { defineOperation } from "@house-rules/domain/contract";
import { NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { MyBooking, ReadUnavailable, ReadCallerDenied } from "./my-bookings.ts";

export const myBookingsNode = defineOperation("MyBookings.myBookings", {
  description: "List the calling person’s bookings with their payment status.",
  input: NoInput,
  output: Schema.Array(MyBooking),
  failure: Schema.Union([ReadUnavailable, ReadCallerDenied]),
  permission: "bookings:read",

  readOnly: true,
});
export const MyBookingsOperations = { myBookings: myBookingsNode } as const;
