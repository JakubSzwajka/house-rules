import { defineOperation } from "@house-rules/domain/contract";
import { NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { MyBooking, ReadUnavailable, ReadCallerDenied } from "./my-bookings.ts";

export const myBookingsNode = defineOperation("MyStuff.myBookings", {
  description: "List the calling person’s bookings with their payment status.",
  input: NoInput,
  output: Schema.Array(MyBooking),
  failure: Schema.Union([ReadUnavailable, ReadCallerDenied]),
  permission: "bookings:read",

  readOnly: true,
});
export const MyStuffOperations = { myBookings: myBookingsNode } as const;
