import { bindOperation, type Binding } from "@house-rules/application";
import type { Actor, Caller, NoOpenUnit } from "@house-rules/domain";
import { Effect } from "effect";
import {
  type Booking,
  type NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingCallerDenied,
  type BookingStoreUnavailable,
} from "./booking.ts";
import {
  type BookingRelation,
  relationOf,
  bookingPolicy,
  BookingPermissions,
} from "./booking-policy.ts";
import { getNode, bookNode, cancelNode } from "./operations.ts";

type Service = {
  readonly get: (
    actor: Actor,
    id: string,
  ) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable>;
  readonly book: (
    actor: Actor,
    input: NewBooking,
  ) => Effect.Effect<Booking, BookingAlreadyExists | BookingStoreUnavailable | NoOpenUnit>;
  readonly cancel: (
    actor: Actor,
    id: string,
  ) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable | NoOpenUnit>;
  readonly relation: (
    actor: Actor,
    id: string,
  ) => Effect.Effect<BookingRelation, BookingStoreUnavailable>;
};

export const bindBookings = (bookings: Service): readonly Binding[] => [
  bindOperation(getNode, ({ id }, { caller }) =>
    caller.kind === "person"
      ? bookings.get(caller.actor, id)
      : Effect.fail(new BookingCallerDenied()),
  ),
  bindOperation(bookNode, (input, { caller }) =>
    caller.kind === "person"
      ? bookings.book(caller.actor, input)
      : Effect.fail(new BookingCallerDenied()),
  ),
  bindOperation(cancelNode, ({ id }, { caller }) =>
    caller.kind === "person"
      ? bookings.cancel(caller.actor, id)
      : Effect.fail(new BookingCallerDenied()),
  ),
];
