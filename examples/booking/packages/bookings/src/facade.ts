import { type Actor, defineModule, type NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import { BookingStore } from "./storage.ts";
import {
  type Booking,
  type NewBooking,
  BookingNotFound,
  BookingAlreadyExists,
  BookingCallerDenied,
  type BookingStoreUnavailable,
} from "./booking/booking.ts";
import {
  type BookingRelation,
  relationOf,
  bookingPolicy,
  BookingPermissions,
} from "./booking/booking-policy.ts";

export class Bookings extends defineModule<
  Bookings,
  {
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
  }
>()("@example/api/modules/bookings/Bookings", {
  make: Effect.gen(function* () {
    const store = yield* BookingStore;
    const required = UnitOfWork.required;
    return {
      get: Effect.fn("Bookings.get")(function* (actor: Actor, id: string) {
        const row = yield* store.find(id);
        if (
          row === undefined ||
          !bookingPolicy.allows(relationOf(actor, row), row.status, BookingPermissions.read)
        ) {
          return yield* new BookingNotFound({ id });
        }
        return row;
      }),
      book: Effect.fn("Bookings.book")(function* (actor: Actor, input: NewBooking) {
        yield* required;
        const row: Booking = { ...input, ownerId: actor.id, status: "active" };
        if (!(yield* store.insert(row))) return yield* new BookingAlreadyExists({ id: input.id });
        return row;
      }),
      cancel: Effect.fn("Bookings.cancel")(function* (actor: Actor, id: string) {
        yield* required;
        const row = yield* store.find(id);
        if (
          row === undefined ||
          !bookingPolicy.allows(relationOf(actor, row), row.status, BookingPermissions.cancel)
        ) {
          return yield* new BookingNotFound({ id });
        }
        if (!(yield* store.transition(id, actor.id, "active", "cancelled")))
          return yield* new BookingNotFound({ id });
        return { ...row, status: "cancelled" as const };
      }),
      relation: Effect.fn("Bookings.relation")(function* (actor: Actor, id: string) {
        return relationOf(actor, yield* store.find(id));
      }),
    };
  }),
}) {}
