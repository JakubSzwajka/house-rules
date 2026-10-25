import { type Actor, definePolicy } from "@house-rules/domain";
import type { Booking } from "./booking.ts";

export { BookingPermissions } from "./permissions.ts";
import { BookingPermissions } from "./permissions.ts";
export type BookingRelation = "owner" | "none";
export const relationOf = (actor: Actor, booking: Booking | undefined): BookingRelation =>
  booking?.ownerId === actor.id ? "owner" : "none";
export const bookingPolicy = definePolicy({
  owner: [BookingPermissions.read, BookingPermissions.cancel],
  none: [],
}).withStates({
  active: [BookingPermissions.read, BookingPermissions.cancel],
  cancelled: [BookingPermissions.read],
});
