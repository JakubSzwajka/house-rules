import { localWho } from "../../composition/callers.ts";
import { defineWay, May, Mean } from "@house-rules/application";
import { partnerPermissions } from "../../composition/entries.ts";
import { partnerBookingEntry } from "../../features/book-for-partner/entry.ts";
import { endpoints } from "./endpoints.ts";
const entries = [partnerBookingEntry] as const;
export const partnerWay = defineWay({
  name: "partner",
  path: "/partner",
  protocol: "http",
  entries,
  endpoints,
  who: localWho("partner"),
  may: May.fixed(entries, partnerPermissions),
  mean: Mean.no,
});
