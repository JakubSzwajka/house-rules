import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  Booking,
  NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingCallerDenied,
  BookingStoreUnavailable,
} from "./booking.ts";
import { BookingPermissions } from "./permissions.ts";

const byId = Schema.Struct({ id: Schema.NonEmptyString });
export const getNode = defineOperation("Bookings.get", {
  description: "Read an owned booking, including its status.",
  input: byId,
  output: Booking,
  failure: Schema.Union([BookingNotFound, BookingCallerDenied, BookingStoreUnavailable]),
  permission: BookingPermissions.read,

  readOnly: true,
});
export const bookNode = defineOperation("Bookings.book", {
  description: "Create an active booking for the calling person.",
  input: NewBooking,
  output: Booking,
  failure: Schema.Union([BookingAlreadyExists, BookingCallerDenied, BookingStoreUnavailable]),
  permission: BookingPermissions.write,

  transactional: true,
});
export const cancelNode = defineOperation("Bookings.cancel", {
  description: "Cancel an active booking owned by the caller.",
  input: byId,
  output: Booking,
  failure: Schema.Union([BookingNotFound, BookingCallerDenied, BookingStoreUnavailable]),
  permission: BookingPermissions.cancel,

  transactional: true,
  destructive: true,
  needsApproval: true,
});

export const BookingsOperations = { get: getNode, book: bookNode, cancel: cancelNode } as const;
