import { BookingsNodes } from "@example/bookings/contract";
import { bindNode } from "@house-rules/application";
import { partnerBooking } from "./node.ts";
export const partnerBookingBinding = bindNode(partnerBooking, (input, { call: callNode }) =>
  callNode(BookingsNodes.book, input),
);
