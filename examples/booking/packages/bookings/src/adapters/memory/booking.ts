import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { BookingStore } from "../../storage.ts";
import type { Booking, BookingStatus } from "../../booking/booking.ts";

export const memoryBookingStore = (records: readonly Booking[] = []) =>
  Layer.sync(BookingStore, () => {
    const rows = new Map(records.map((row) => [row.id, { ...row }]));
    const required = UnitOfWork.required;
    const onRollback = UnitOfWork.onRollback;
    return BookingStore.of({
      find: (id) =>
        Effect.sync(() => {
          const row = rows.get(id);
          return row === undefined ? undefined : { ...row };
        }),
      insert: Effect.fn("BookingStore.memory.insert")(function* (row: Booking) {
        yield* required;
        if (rows.has(row.id)) return false;
        yield* onRollback(Effect.sync(() => void rows.delete(row.id)));
        rows.set(row.id, { ...row });
        return true;
      }),
      transition: Effect.fn("BookingStore.memory.transition")(function* (
        id: string,
        ownerId: string,
        from: BookingStatus,
        to: BookingStatus,
      ) {
        yield* required;
        const row = rows.get(id);
        if (row === undefined || row.ownerId !== ownerId || row.status !== from) return false;
        yield* onRollback(Effect.sync(() => void rows.set(id, row)));
        rows.set(id, { ...row, status: to });
        return true;
      }),
    });
  });
