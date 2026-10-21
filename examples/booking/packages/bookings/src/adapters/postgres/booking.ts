import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { BookingStore } from "../../storage.ts";
import { Booking, BookingStatus, BookingStoreUnavailable } from "../../booking/booking.ts";

const unavailable = (cause: { readonly message: string }) => new BookingStoreUnavailable({ cause });
export const postgresBookingStore = Layer.effect(
  BookingStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const required = UnitOfWork.required;
    const find = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Booking,
      execute: (id) =>
        sql`select id, guest_name as "guestName", owner_id as "ownerId", status from booking where id = ${id}`,
    });
    const insert = SqlSchema.findAll({
      Request: Booking,
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({
        id,
        guestName,
        ownerId,
        status,
      }) => sql`insert into booking (id, guest_name, owner_id, status)
      values (${id}, ${guestName}, ${ownerId}, ${status}) on conflict (id) do nothing returning id`,
    });
    const transition = SqlSchema.findAll({
      Request: Schema.Struct({
        id: Schema.String,
        ownerId: Schema.String,
        from: BookingStatus,
        to: BookingStatus,
      }),
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, ownerId, from, to }) => sql`update booking set status = ${to}
      where id = ${id} and owner_id = ${ownerId} and status = ${from} returning id`,
    });
    return BookingStore.of({
      find: (id) =>
        find(id).pipe(
          Effect.map((row) => (row._tag === "Some" ? row.value : undefined)),
          Effect.mapError(unavailable),
        ),
      insert: Effect.fn("BookingStore.postgres.insert")(function* (row: Booking) {
        yield* required;
        return (yield* insert(row).pipe(Effect.mapError(unavailable))).length > 0;
      }),
      transition: Effect.fn("BookingStore.postgres.transition")(function* (
        id: string,
        ownerId: string,
        from: BookingStatus,
        to: BookingStatus,
      ) {
        yield* required;
        return (
          (yield* transition({ id, ownerId, from, to }).pipe(Effect.mapError(unavailable))).length >
          0
        );
      }),
    });
  }),
);
