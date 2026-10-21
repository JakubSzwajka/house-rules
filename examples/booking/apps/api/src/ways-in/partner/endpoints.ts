import { endpoint, defineApi } from "@house-rules/application/contract";
import { partnerBookingEntry } from "../../features/book-for-partner/entry.ts";
export const api = defineApi(
  { prefix: "/partner" },
  { partnerBooking: endpoint(partnerBookingEntry) },
);
export const endpoints = Object.values(api.endpoints);
