import { endpoint, defineApi } from "@house-rules/application/contract";
import { makeBookingEntry } from "../../features/make-booking/entry.ts";
import { showBookingEntry } from "../../features/show-booking/entry.ts";
import { myBookingsEntry } from "../../features/my-bookings/entry.ts";
import { cancelBookingEntry } from "../../features/cancel-booking/entry.ts";
export const api = defineApi(
  { prefix: "/api" },
  {
    makeBooking: endpoint(makeBookingEntry),
    showBooking: endpoint(showBookingEntry),
    myBookings: endpoint(myBookingsEntry),
    cancelBooking: endpoint(cancelBookingEntry),
  },
);
export const endpoints = Object.values(api.endpoints);
