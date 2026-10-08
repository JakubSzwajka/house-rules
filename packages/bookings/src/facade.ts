import type { NoOpenUnit } from "@house-rules/capability";
import { Context, Effect, Layer } from "effect";
import { memoryBookingStore } from "./adapters/memory/memory-booking-store.js";
import { BookingStore } from "./storage.js";
import type { BookingStoreUnavailable } from "./booking/store-unavailable.js";
import { type Booking, BookingAlreadyExists, BookingNotFound } from "./booking/booking.js";

export class Bookings extends Context.Service<
  Bookings,
  {
    readonly get: (id: string) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable>;
    readonly create: (
      booking: Booking,
    ) => Effect.Effect<Booking, BookingAlreadyExists | BookingStoreUnavailable | NoOpenUnit>;
  }
>()("@hosti/bookings/Bookings") {
  static readonly layer: Layer.Layer<Bookings, never, BookingStore> = Layer.effect(
    this,
    Effect.gen(function* bookingsLayer() {
      const store = yield* BookingStore;
      return Bookings.of({
        get: Effect.fn("Bookings.get")(function* get(id: string) {
          const booking = yield* store.find(id);
          if (booking === undefined) {
            return yield* new BookingNotFound({ id });
          }
          return booking;
        }),
        create: Effect.fn("Bookings.create")(function* create(booking: Booking) {
          if (!(yield* store.insert(booking))) {
            return yield* new BookingAlreadyExists({ id: booking.id });
          }
          return booking;
        }),
      });
    }),
  );

  // The memory adapter seeded with records, for tests and for apps with nothing to persist.
  static readonly fromRecords = (records: readonly Booking[]): Layer.Layer<Bookings> =>
    this.layer.pipe(Layer.provide(memoryBookingStore(records)));
}
