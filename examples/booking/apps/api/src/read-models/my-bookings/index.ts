import { MyBookingsOperations } from "../../projections/my-bookings/contract.ts";
import { defineReadModel } from "@house-rules/application/contract";
export const myBookings = defineReadModel("my_bookings", {
  description: "List your bookings and their payment status.",
  title: "List your bookings and their payment status",
  permission: null,
  input: MyBookingsOperations.myBookings.input,
  output: MyBookingsOperations.myBookings.output,
  failure: MyBookingsOperations.myBookings.failure,
  flags: { readOnly: true },
  edges: [MyBookingsOperations.myBookings],
  handler: (input, { call }) => call(MyBookingsOperations.myBookings, input),
});
