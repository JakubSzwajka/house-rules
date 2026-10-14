import { route } from "@house-rules/application";
import { showBooking } from "../../use-cases/show-booking.js";
import { bookingEndpoints } from "./endpoints.js";

export const bookingRoutes = [route(showBooking, bookingEndpoints.showBooking)] as const;
