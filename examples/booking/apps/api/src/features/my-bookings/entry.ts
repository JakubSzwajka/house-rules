import { defineEntry } from "@house-rules/application/contract";
import { myBookings } from "./node.ts";
export const myBookingsEntry = defineEntry(myBookings);
