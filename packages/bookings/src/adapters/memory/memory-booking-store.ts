import { UnitOfWork } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { BookingStore } from "../../storage.js";
import type { Booking } from "../../booking/booking.js";

export const memoryBookingStore = (records: readonly Booking[] = []): Layer.Layer<BookingStore> =>
  Layer.sync(BookingStore, () => {
    const rows = new Map<string, Booking>(records.map((booking) => [booking.id, booking]));
    return BookingStore.of({
      find: (id) => Effect.sync(() => rows.get(id)),
      insert: Effect.fn("BookingStore.memory.insert")(function* insert(booking: Booking) {
        yield* UnitOfWork.required;
        if (rows.has(booking.id)) return false;
        // The memory unit runs no transaction, so the store undoes its own write when the unit fails.
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.delete(booking.id)));
        rows.set(booking.id, booking);
        return true;
      }),
    });
  });
