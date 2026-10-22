import { bindOperation, type Binding } from "@house-rules/application";
import { PartyOperations } from "@house-rules/party/contract";
import { Effect } from "effect";
import type { Actor, NoOpenUnit } from "@house-rules/domain";
import {
  type Booking,
  type NewBooking,
  type BookingAccess,
  BookingNotFound,
  BookingAlreadyExists,
  BookingOrganisationDenied,
  BookingCallerDenied,
  BookingStoreUnavailable,
} from "./booking.ts";

type Service = {
  readonly get: (
    actor: Actor,
    id: string,
    access?: BookingAccess,
  ) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable>;
  readonly book: (
    actor: Actor,
    input: NewBooking,
    access?: BookingAccess,
  ) => Effect.Effect<
    Booking,
    BookingAlreadyExists | BookingOrganisationDenied | BookingStoreUnavailable | NoOpenUnit
  >;
  readonly cancel: (
    actor: Actor,
    id: string,
    access?: BookingAccess,
  ) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable | NoOpenUnit>;
};
import { getNode, bookNode, cancelNode } from "./operations.ts";

export const bindBookings = (bookings: Service): readonly Binding[] => [
  bindOperation(getNode, ({ id }, { caller, call }) =>
    caller.kind === "person"
      ? bookings.get(caller.actor, id, {
          staff: (organisationId) =>
            call(PartyOperations.isRelated, {
              from: { kind: "person", id: caller.actor.id },
              to: { kind: "organisation", id: organisationId },
              kind: "staff",
            }).pipe(Effect.mapError((cause) => new BookingStoreUnavailable({ cause }))),
          admin: () => Effect.succeed(false),
        })
      : Effect.fail(new BookingCallerDenied()),
  ),
  bindOperation(bookNode, (input, { caller, call }) =>
    caller.kind === "person"
      ? bookings.book(caller.actor, input, {
          staff: (organisationId) =>
            call(PartyOperations.isRelated, {
              from: { kind: "person", id: caller.actor.id },
              to: { kind: "organisation", id: organisationId },
              kind: "staff",
            }).pipe(Effect.mapError((cause) => new BookingStoreUnavailable({ cause }))),
          admin: (organisationId) =>
            call(PartyOperations.canAdminOrganisation, { organisationId }).pipe(
              Effect.mapError((cause) => new BookingStoreUnavailable({ cause })),
            ),
        })
      : Effect.fail(new BookingCallerDenied()),
  ),
  bindOperation(cancelNode, ({ id }, { caller, call }) =>
    caller.kind === "person"
      ? bookings.cancel(caller.actor, id, {
          staff: (organisationId) =>
            call(PartyOperations.isRelated, {
              from: { kind: "person", id: caller.actor.id },
              to: { kind: "organisation", id: organisationId },
              kind: "staff",
            }).pipe(Effect.mapError((cause) => new BookingStoreUnavailable({ cause }))),
          admin: (organisationId) =>
            call(PartyOperations.canAdminOrganisation, { organisationId }).pipe(
              Effect.mapError((cause) => new BookingStoreUnavailable({ cause })),
            ),
        })
      : Effect.fail(new BookingCallerDenied()),
  ),
];
