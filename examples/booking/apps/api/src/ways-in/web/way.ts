import { Features, memberPermissions } from "../../features/index.ts";
import { localWho } from "../../composition/callers.ts";
import { defineWay, May, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [
  Features.makeBooking,
  Features.showBooking,
  Features.myBookings,
  Features.cancelBooking,
] as const;
export const webWay = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  features,
  endpoints,
  who: localWho("web"),
  may: May.fixed(features, memberPermissions),
  mean: Mean.no,
});
