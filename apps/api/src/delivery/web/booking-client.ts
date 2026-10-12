import { toHttpClient } from "@house-rules/capability/contract";
import { bookingEndpoints } from "../http/endpoints.js";

export const bookingClient = toHttpClient([bookingEndpoints.showBooking], { prefix: "/api" });
