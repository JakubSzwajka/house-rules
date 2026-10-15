import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";
import { PublicBooking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";
import { BookingStoreUnavailable } from "./store-unavailable.js";

export const myBookingsLimit = 100;

export const MyBookings = Schema.Struct({ items: Schema.Array(PublicBooking) });
export type MyBookings = typeof MyBookings.Type;

export const listMyBookingsContract = defineContract("list_my_bookings", {
  description: "List the bookings the signed-in user owns, by id, at most 100.",
  input: Schema.Struct({}),
  output: MyBookings,
  failure: BookingStoreUnavailable,
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});
