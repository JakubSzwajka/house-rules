import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { PaymentStore } from "../../storage.ts";
import { Payment, PaymentStatus, PaymentStoreUnavailable } from "../../payment/payment.ts";

const unavailable = (cause: { readonly message: string }) => new PaymentStoreUnavailable({ cause });
export const postgresPaymentStore = Layer.effect(
  PaymentStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const required = UnitOfWork.required;
    const find = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Payment,
      execute: (id) =>
        sql`select id, booking_id as "bookingId", owner_id as "ownerId", amount, status, created_at::double precision as "createdAt" from payment where id = ${id}`,
    });
    const findByBookingId = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Payment,
      execute: (bookingId) =>
        sql`select id, booking_id as "bookingId", owner_id as "ownerId", amount, status, created_at::double precision as "createdAt" from payment where booking_id = ${bookingId}`,
    });
    const insert = SqlSchema.findAll({
      Request: Payment,
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({
        id,
        bookingId,
        ownerId,
        amount,
        status,
        createdAt,
      }) => sql`insert into payment (id, booking_id, owner_id, amount, status, created_at)
      values (${id}, ${bookingId}, ${ownerId}, ${amount}, ${status}, ${createdAt}) on conflict do nothing returning id`,
    });
    const transition = SqlSchema.findAll({
      Request: Schema.Struct({ id: Schema.String, from: PaymentStatus, to: PaymentStatus }),
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, from, to }) =>
        sql`update payment set status = ${to} where id = ${id} and status = ${from} returning id`,
    });
    const due = SqlSchema.findAll({
      Request: Schema.Int,
      Result: Schema.Struct({ paymentId: Schema.String }),
      execute: (cutoff) =>
        sql`select id as "paymentId" from payment where status = 'pending' and created_at < ${cutoff} order by id`,
    });
    const expire = SqlSchema.findAll({
      Request: Schema.Struct({ id: Schema.String, cutoff: Schema.Int }),
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, cutoff }) =>
        sql`update payment set status = 'expired' where id = ${id} and status = 'pending' and created_at < ${cutoff} returning id`,
    });
    return PaymentStore.of({
      find: (id) =>
        find(id).pipe(
          Effect.map((row) => (row._tag === "Some" ? row.value : undefined)),
          Effect.mapError(unavailable),
        ),
      findByBookingId: (id) =>
        findByBookingId(id).pipe(
          Effect.map((row) => (row._tag === "Some" ? row.value : undefined)),
          Effect.mapError(unavailable),
        ),
      insert: Effect.fn("PaymentStore.postgres.insert")(function* (row: Payment) {
        yield* required;
        return (yield* insert(row).pipe(Effect.mapError(unavailable))).length > 0;
      }),
      transition: Effect.fn("PaymentStore.postgres.transition")(function* (
        id: string,
        from: PaymentStatus,
        to: PaymentStatus,
      ) {
        yield* required;
        return (yield* transition({ id, from, to }).pipe(Effect.mapError(unavailable))).length > 0;
      }),
      dueBefore: (cutoff) => due(cutoff).pipe(Effect.mapError(unavailable)),
      expireOne: Effect.fn("PaymentStore.postgres.expireOne")(function* (
        id: string,
        cutoff: number,
      ) {
        yield* required;
        return (yield* expire({ id, cutoff }).pipe(Effect.mapError(unavailable))).length > 0;
      }),
    });
  }),
);
