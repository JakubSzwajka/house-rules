import { Features, partnerPermissions } from "../../features/index.ts";
import { localWho } from "../../composition/callers.ts";
import { defineWay, May, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [Features.partnerBooking] as const;
export const partnerWay = defineWay({
  name: "partner",
  path: "/partner",
  protocol: "http",
  features,
  endpoints,
  who: localWho("partner"),
  may: May.fixed(features, partnerPermissions),
  mean: Mean.no,
});
