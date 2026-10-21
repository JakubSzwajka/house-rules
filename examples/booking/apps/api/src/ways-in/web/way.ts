import { Features } from "../../features/index.ts";
import { localWho } from "../../composition/callers.ts";
import { defineWay, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [
  Features.makeBooking,
  Features.showBooking,
  Features.myBookings,
  Features.cancelBooking,
  Features.defineRole,
  Features.listRoles,
  Features.assignRole,
  Features.revokeRole,
] as const;
export const webWay = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  features,
  endpoints,
  who: localWho("web"),
  mean: Mean.no,
});
