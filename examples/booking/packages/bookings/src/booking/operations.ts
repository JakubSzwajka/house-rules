import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { PartyOperations } from "@house-rules/party/contract";
import {
  Booking,
  NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingOrganisationDenied,
  BookingCallerDenied,
  BookingStoreUnavailable,
} from "./booking.ts";
import { BookingPermissions } from "./permissions.ts";

const byId = Schema.Struct({ id: Schema.NonEmptyString });
export const getNode = defineOperation("Bookings.get", {
  description: "Read an owned booking or a booking of an organisation you staff.",
  edges: [PartyOperations.isRelated],
  input: byId,
  output: Booking,
  failure: Schema.Union([BookingNotFound, BookingCallerDenied, BookingStoreUnavailable]),
  permission: BookingPermissions.read,

  readOnly: true,
});
export const bookNode = defineOperation("Bookings.book", {
  description: "Create a personal booking or book for your organisation.",
  edges: [PartyOperations.isRelated, PartyOperations.canAdminOrganisation],
  input: NewBooking,
  output: Booking,
  failure: Schema.Union([
    BookingAlreadyExists,
    BookingOrganisationDenied,
    BookingCallerDenied,
    BookingStoreUnavailable,
  ]),
  permission: BookingPermissions.write,

  transactional: true,
});
export const cancelNode = defineOperation("Bookings.cancel", {
  description: "Cancel your own booking, or another staff booking as its organisation admin.",
  edges: [PartyOperations.isRelated, PartyOperations.canAdminOrganisation],
  input: byId,
  output: Booking,
  failure: Schema.Union([BookingNotFound, BookingCallerDenied, BookingStoreUnavailable]),
  permission: BookingPermissions.cancel,

  transactional: true,
  destructive: true,
  needsApproval: true,
});

export const BookingsOperations = { get: getNode, book: bookNode, cancel: cancelNode } as const;
