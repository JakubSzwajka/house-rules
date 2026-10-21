import { defineEntry } from "@house-rules/application/contract";
import { cancelBooking } from "./node.ts";
export const cancelBookingEntry = defineEntry(cancelBooking);
