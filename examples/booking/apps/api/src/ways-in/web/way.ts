import { localWho } from "../../composition/callers.ts";
import { defineWay, May, Mean } from "@house-rules/application";
import { memberPermissions } from "../../composition/entries.ts";
import { makeBookingEntry } from "../../features/make-booking/entry.ts";
import { showBookingEntry } from "../../features/show-booking/entry.ts";
import { myBookingsEntry } from "../../features/my-bookings/entry.ts";
import { cancelBookingEntry } from "../../features/cancel-booking/entry.ts";
import { endpoints } from "./endpoints.ts";
const entries = [makeBookingEntry, showBookingEntry, myBookingsEntry, cancelBookingEntry] as const;
export const webWay = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  entries,
  endpoints,
  who: localWho("web"),
  may: May.fixed(entries, memberPermissions),
  mean: Mean.no,
});
