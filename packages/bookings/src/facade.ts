import { type Actor, defineModule, type NoOpenUnit } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { memoryBookingStore } from "./adapters/memory/memory-booking-store.js";
import { BookingStore } from "./storage.js";
import type { BookingStoreUnavailable } from "./booking/store-unavailable.js";
import {
  type Booking,
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
    readonly relation: (
      actor: Actor,
      id: string,
    ) => Effect.Effect<"owner" | "none", BookingStoreUnavailable>;
  }
>()("@hosti/bookings/Bookings", {
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
        const booking = { id: input.id, guestName: input.guestName, ownerId: actor.id };
        if (!(yield* store.insert(booking))) {
          return yield* new BookingAlreadyExists({ id: booking.id });
        }
        return booking;
      }),
      relation: Effect.fn("Bookings.relation")(function* relation(actor: Actor, id: string) {
        const booking = yield* store.find(id);
        return booking?.ownerId === actor.id ? "owner" : "none";
      }),
    };
  }),
}) {
  // The memory adapter seeded with records, for tests and for apps with nothing to persist.
  static readonly fromRecords = (records: readonly Booking[]): Layer.Layer<Bookings> =>
    this.layer.pipe(Layer.provide(memoryBookingStore(records)));
}
