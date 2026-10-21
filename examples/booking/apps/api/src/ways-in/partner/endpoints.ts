import { Features } from "../../features/index.ts";
import { endpoint, defineApi } from "@house-rules/application/contract";
export const api = defineApi(
  { prefix: "/partner" },
  { partnerBooking: endpoint(Features.partnerBooking) },
);
export const endpoints = Object.values(api.endpoints);
