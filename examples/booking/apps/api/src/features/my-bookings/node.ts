import { MyStuffNodes } from "../../read-models/my-bookings/contract.ts";
import { defineNode } from "@house-rules/domain/contract";
export const myBookings = defineNode("my_bookings", {
  description: "List your bookings and their payment status.",
  title: "List your bookings and their payment status",
  permission: null,
  input: MyStuffNodes.myBookings.input,
  output: MyStuffNodes.myBookings.output,
  failure: MyStuffNodes.myBookings.failure,
  readOnly: true,
  edges: [MyStuffNodes.myBookings],
});
