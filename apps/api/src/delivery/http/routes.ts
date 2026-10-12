import { route } from "@house-rules/capability";
import { showBooking } from "../../use-cases/show-booking.js";

export const bookingRoutes = [route(showBooking, "GET /bookings/:id")] as const;
