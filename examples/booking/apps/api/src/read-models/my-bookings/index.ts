import { MyBookings } from "./facade.ts";
import { MyBookingsOperations } from "./booking/operations.ts";
import { bindMyBookings } from "./booking/bind-my-bookings.ts";
import type { MountDefinition } from "@house-rules/application";
export const MyBookingsMount = {
  map: { name: "my-bookings", kind: "read-model", package: "@example/api" },
  service: MyBookings,
  operations: Object.values(MyBookingsOperations),
  bind: bindMyBookings,
} satisfies MountDefinition<MyBookings, MyBookings["Service"]>;
export { MyBookings };
export { bindMyBookings } from "./booking/bind-my-bookings.ts";
export { MyBookingsOperations } from "./booking/operations.ts";
export { MyBooking, ReadUnavailable, ReadCallerDenied } from "./booking/my-bookings.ts";
export { MyBookingStore } from "./storage.ts";
export { postgresMyBookingStore } from "./adapters/postgres/my-bookings.ts";
