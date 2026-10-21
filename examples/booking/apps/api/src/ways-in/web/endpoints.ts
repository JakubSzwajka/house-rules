import { Features } from "../../features/index.ts";
import { endpoint, defineApi } from "@house-rules/application/contract";
export const api = defineApi(
  { prefix: "/api" },
  {
    makeBooking: endpoint(Features.makeBooking),
    showBooking: endpoint(Features.showBooking),
    myBookings: endpoint(Features.myBookings),
    cancelBooking: endpoint(Features.cancelBooking),
    defineRole: endpoint(Features.defineRole),
    listRoles: endpoint(Features.listRoles),
    assignRole: endpoint(Features.assignRole),
    revokeRole: endpoint(Features.revokeRole),
  },
);
export const endpoints = Object.values(api.endpoints);
