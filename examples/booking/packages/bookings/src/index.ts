import { Bookings } from "./facade.ts";
import { BookingsOperations } from "./booking/operations.ts";
import { bindBookings } from "./booking/bind-bookings.ts";
import type { MountDefinition } from "@house-rules/application";
export const BookingsMount = {
  map: { name: "bookings", kind: "package", package: "@example/bookings" },
  service: Bookings,
  operations: Object.values(BookingsOperations),
  bind: bindBookings,
} satisfies MountDefinition<Bookings, Bookings["Service"]>;
export { Bookings };
export { bindBookings } from "./booking/bind-bookings.ts";
export { BookingsOperations } from "./booking/operations.ts";
export {
  Booking,
  BookingStatus,
  NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingCallerDenied,
  BookingOrganisationDenied,
  BookingStoreUnavailable,
} from "./booking/booking.ts";
export {
  BookingPermissions,
  bookingPolicy,
  relationOf,
  type BookingRelation,
} from "./booking/booking-policy.ts";
export { BookingStore } from "./storage.ts";
export { memoryBookingStore } from "./adapters/memory/booking.ts";
export { postgresBookingStore } from "./adapters/postgres/booking.ts";
