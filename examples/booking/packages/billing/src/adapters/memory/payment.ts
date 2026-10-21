import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { PaymentStore } from "../../storage.ts";
import type { Payment, PaymentStatus } from "../../payment/payment.ts";

export const memoryPaymentStore = (records: readonly Payment[] = []) =>
  Layer.sync(PaymentStore, () => {
    const rows = new Map(records.map((row) => [row.id, { ...row }]));
    const required = UnitOfWork.required;
    const onRollback = UnitOfWork.onRollback;
    const copy = (row: Payment | undefined) => (row === undefined ? undefined : { ...row });
    return PaymentStore.of({
      find: (id) => Effect.sync(() => copy(rows.get(id))),
      findByBookingId: (bookingId) =>
        Effect.sync(() => copy([...rows.values()].find((row) => row.bookingId === bookingId))),
      insert: Effect.fn("PaymentStore.memory.insert")(function* (row: Payment) {
        yield* required;
        if (
          rows.has(row.id) ||
          [...rows.values()].some((other) => other.bookingId === row.bookingId)
        )
          return false;
        yield* onRollback(Effect.sync(() => void rows.delete(row.id)));
        rows.set(row.id, { ...row });
        return true;
      }),
      transition: Effect.fn("PaymentStore.memory.transition")(function* (
        id: string,
        from: PaymentStatus,
        to: PaymentStatus,
      ) {
        yield* required;
        const row = rows.get(id);
        if (row === undefined || row.status !== from) return false;
        yield* onRollback(Effect.sync(() => void rows.set(id, row)));
        rows.set(id, { ...row, status: to });
        return true;
      }),
      expireBefore: Effect.fn("PaymentStore.memory.expireBefore")(function* (cutoff: number) {
        yield* required;
        const expired = [...rows.values()].filter(
          (row) => row.status === "pending" && row.createdAt < cutoff,
        );
        yield* onRollback(
          Effect.sync(() => {
            for (const row of expired) rows.set(row.id, row);
          }),
        );
        for (const row of expired) rows.set(row.id, { ...row, status: "expired" });
        return expired.length;
      }),
    });
  });
