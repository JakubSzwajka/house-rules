import { type Actor, definePolicy } from "@house-rules/domain";
import type { Booking } from "./booking.js";
import { BookingPermissions } from "./permissions.js";

export type BookingRelation = "owner" | "none";

export const relationOf = (actor: Actor, booking: Booking | undefined): BookingRelation =>
  booking?.ownerId === actor.id ? "owner" : "none";

export const bookingPolicy = definePolicy({
  owner: [BookingPermissions.cancel],
  none: [],
}).withStates({
  active: [BookingPermissions.cancel],
  cancelled: [],
});
