import { showBookingContract } from "@example/bookings/contract";
import { endpoint } from "@house-rules/application/contract";

export const bookingEndpoints = {
  showBooking: endpoint(showBookingContract, "GET /bookings/:id", { codes: ["not_found"] }),
} as const;
