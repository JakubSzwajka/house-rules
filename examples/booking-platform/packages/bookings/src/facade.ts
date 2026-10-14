import { type Actor, defineModule, type NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { memoryBookingStore } from "./adapters/memory/memory-booking-store.js";
import { BookingStore } from "./storage.js";
import type { BookingStoreUnavailable } from "./booking/store-unavailable.js";
import { type BookingRelation, bookingPolicy, relationOf } from "./booking/booking-policy.js";
import { BookingPermissions } from "./booking/permissions.js";
import {
  type Booking,
  BookingAlreadyCancelled,
  BookingAlreadyExists,
  BookingNotFound,
  type NewBooking,
} from "./booking/booking.js";

export class Bookings extends defineModule<
  Bookings,
  {
    readonly get: (id: string) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable>;
    readonly create: (
      actor: Actor,
      input: NewBooking,
    ) => Effect.Effect<Booking, BookingAlreadyExists | BookingStoreUnavailable | NoOpenUnit>;
    readonly cancel: (
      actor: Actor,
      id: string,
    ) => Effect.Effect<
      Booking,
      BookingNotFound | BookingAlreadyCancelled | BookingStoreUnavailable | NoOpenUnit
    >;
    readonly relation: (
      actor: Actor,
      id: string,
    ) => Effect.Effect<BookingRelation, BookingStoreUnavailable>;
  }
>()("@example/bookings/Bookings", {
  make: Effect.gen(function* bookingsLayer() {
    const store = yield* BookingStore;
    return {
      get: Effect.fn("Bookings.get")(function* get(id: string) {
        const booking = yield* store.find(id);
        if (booking === undefined) {
          return yield* new BookingNotFound({ id });
        }
        return booking;
      }),
      create: Effect.fn("Bookings.create")(function* create(actor: Actor, input: NewBooking) {
        yield* UnitOfWork.required;
        const booking: Booking = {
          id: input.id,
          guestName: input.guestName,
          ownerId: actor.id,
          status: "active",
        };
        if (!(yield* store.insert(booking))) {
          return yield* new BookingAlreadyExists({ id: booking.id });
        }
        return booking;
      }),
      cancel: Effect.fn("Bookings.cancel")(function* cancel(actor: Actor, id: string) {
        yield* UnitOfWork.required;
        const booking = yield* store.find(id);
        const relation = relationOf(actor, booking);
        if (booking === undefined || relation === "none") {
          return yield* new BookingNotFound({ id });
        }
        if (
          !bookingPolicy.allows(relation, booking.status, BookingPermissions.cancel) ||
          !(yield* store.transition(id, booking.status, "cancelled"))
        ) {
          return yield* new BookingAlreadyCancelled({ id });
        }
        return { ...booking, status: "cancelled" as const };
      }),
      relation: Effect.fn("Bookings.relation")(function* relation(actor: Actor, id: string) {
        return relationOf(actor, yield* store.find(id));
      }),
    };
  }),
}) {
  // The memory adapter seeded with records, for tests and for apps with nothing to persist.
  static readonly fromRecords = (records: readonly Booking[]): Layer.Layer<Bookings> =>
    this.layer.pipe(Layer.provide(memoryBookingStore(records)));
}
