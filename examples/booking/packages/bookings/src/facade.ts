import { type Actor, defineModule, type NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import { BookingStore } from "./storage.ts";
import {
  type Booking,
  type NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingOrganisationDenied,
  type BookingAccess,
  type BookingStoreUnavailable,
} from "./booking/booking.ts";
import { type BookingRelation, relationOf } from "./booking/booking-policy.ts";

export class Bookings extends defineModule<
  Bookings,
  {
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
    readonly relation: (
      actor: Actor,
      id: string,
    ) => Effect.Effect<BookingRelation, BookingStoreUnavailable>;
  }
>()("@example/bookings/Bookings", {
  make: Effect.gen(function* () {
    const store = yield* BookingStore;
    const required = UnitOfWork.required;
    return {
      get: Effect.fn("Bookings.get")(function* (actor: Actor, id: string, access?: BookingAccess) {
        const row = yield* store.find(id);
        if (
          row === undefined ||
          (row.ownerId !== actor.id &&
            !(row.organisationId && access && (yield* access.staff(row.organisationId))))
        ) {
          return yield* new BookingNotFound({ id });
        }
        return row;
      }),
      book: Effect.fn("Bookings.book")(function* (
        actor: Actor,
        input: NewBooking,
        access?: BookingAccess,
      ) {
        yield* required;
        const organisationId = input.organisationId ?? null;
        if (
          organisationId &&
          !(
            access &&
            ((yield* access.staff(organisationId)) || (yield* access.admin(organisationId)))
          )
        )
          return yield* new BookingOrganisationDenied();
        const row: Booking = { ...input, organisationId, ownerId: actor.id, status: "active" };
        if (!(yield* store.insert(row))) return yield* new BookingAlreadyExists({ id: input.id });
        return row;
      }),
      cancel: Effect.fn("Bookings.cancel")(function* (
        actor: Actor,
        id: string,
        access?: BookingAccess,
      ) {
        yield* required;
        const row = yield* store.find(id);
        if (
          row === undefined ||
          row.status !== "active" ||
          (row.ownerId !== actor.id &&
            !(
              row.organisationId &&
              access &&
              (yield* access.staff(row.organisationId)) &&
              (yield* access.admin(row.organisationId))
            ))
        ) {
          return yield* new BookingNotFound({ id });
        }
        if (!(yield* store.transition(id, row.ownerId, "active", "cancelled")))
          return yield* new BookingNotFound({ id });
        return { ...row, status: "cancelled" as const };
      }),
      relation: Effect.fn("Bookings.relation")(function* (actor: Actor, id: string) {
        return relationOf(actor, yield* store.find(id));
      }),
    };
  }),
}) {}
