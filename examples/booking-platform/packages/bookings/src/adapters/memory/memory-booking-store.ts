import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { BookingStore } from "../../storage.js";
import type { Booking, BookingStatus } from "../../booking/booking.js";

export const memoryBookingStore = (records: readonly Booking[] = []): Layer.Layer<BookingStore> =>
  Layer.sync(BookingStore, () => {
    const rows = new Map<string, Booking>(records.map((booking) => [booking.id, { ...booking }]));
    return BookingStore.of({
      find: (id) => Effect.sync(() => rows.get(id)),
      listByOwner: (ownerId, limit) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter((booking) => booking.ownerId === ownerId)
            .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
            .slice(0, limit)
            .map((booking) => ({ ...booking })),
        ),
      insert: Effect.fn("BookingStore.memory.insert")(function* insert(booking: Booking) {
        yield* UnitOfWork.required;
        if (rows.has(booking.id)) return false;
        // The memory unit runs no transaction, so the store undoes its own write when the unit fails.
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.delete(booking.id)));
        rows.set(booking.id, { ...booking });
        return true;
      }),
      transition: Effect.fn("BookingStore.memory.transition")(function* transition(
        id: string,
        from: BookingStatus,
        to: BookingStatus,
      ) {
        yield* UnitOfWork.required;
        const row = rows.get(id);
        if (row === undefined || row.status !== from) return false;
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.set(id, row)));
        rows.set(id, { ...row, status: to });
        return true;
      }),
    });
  });
