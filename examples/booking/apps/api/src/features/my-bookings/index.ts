import { MyStuffOperations } from "../../read-models/my-bookings/contract.ts";
import { defineFeature } from "@house-rules/application/contract";
export const myBookings = defineFeature("my_bookings", {
  description: "List your bookings and their payment status.",
  title: "List your bookings and their payment status",
  permission: null,
  input: MyStuffOperations.myBookings.input,
  output: MyStuffOperations.myBookings.output,
  failure: MyStuffOperations.myBookings.failure,
  flags: { readOnly: true },
  edges: [MyStuffOperations.myBookings],
  handler: (input, { call: callNode }) => callNode(MyStuffOperations.myBookings, input),
});
