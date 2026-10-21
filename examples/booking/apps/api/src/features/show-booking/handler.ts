import { BookingsNodes } from "@example/bookings/contract";
import { bindNode } from "@house-rules/application";
import { showBooking } from "./node.ts";
export const showBookingBinding = bindNode(showBooking, (input, { call: callNode }) =>
  callNode(BookingsNodes.get, input),
);
