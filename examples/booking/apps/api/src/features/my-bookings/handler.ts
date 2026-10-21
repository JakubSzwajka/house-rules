import { MyStuffNodes } from "../../read-models/my-bookings/contract.ts";
import { bindNode } from "@house-rules/application";
import { myBookings } from "./node.ts";
export const myBookingsBinding = bindNode(myBookings, (input, { call: callNode }) =>
  callNode(MyStuffNodes.myBookings, input),
);
