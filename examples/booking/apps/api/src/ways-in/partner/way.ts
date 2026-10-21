import { Features } from "../../features/index.ts";
import { localWho } from "../../composition/callers.ts";
import { defineWay, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [Features.partnerBooking] as const;
export const partnerWay = defineWay({
  name: "partner",
  path: "/partner",
  protocol: "http",
  features,
  endpoints,
  who: localWho("partner"),
  mean: Mean.no,
});
