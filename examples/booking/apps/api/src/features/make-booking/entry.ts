import { defineEntry } from "@house-rules/application/contract";
import { makeBooking } from "./node.ts";
export const makeBookingEntry = defineEntry(makeBooking);
