import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { BookingStore } from "../../storage.js";
import { BookingStoreUnavailable } from "../../booking/store-unavailable.js";
import { Booking, BookingStatus } from "../../booking/booking.js";

const unavailable = (message: string) => (cause: { readonly message: string }) =>
  new BookingStoreUnavailable({ message: `${message}: ${cause.message}`, cause });

const Transition = Schema.Struct({ id: Schema.String, from: BookingStatus, to: BookingStatus });

export const postgresBookingStore: Layer.Layer<BookingStore, never, SqlClient> = Layer.effect(
  BookingStore,
  Effect.gen(function* postgresBookingStore() {
    const sql = yield* SqlClient;
    const findOne = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Booking,
      execute: (id) =>
        sql`select id, guest_name as "guestName", owner_id as "ownerId", status
          from booking where id = ${id}`,
    });
    // Returns the id when the row was written, and no row when the id is taken.
    const insertOne = SqlSchema.findAll({
      Request: Booking,
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, guestName, ownerId, status }) =>
        sql`insert into booking (id, guest_name, owner_id, status)
          values (${id}, ${guestName}, ${ownerId}, ${status})
          on conflict (id) do nothing returning id`,
    });
    // The status guard sits in the statement, so two concurrent moves cannot both pass.
    const moveOne = SqlSchema.findAll({
      Request: Transition,
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, from, to }) =>
        sql`update booking set status = ${to} where id = ${id} and status = ${from} returning id`,
    });
    return BookingStore.of({
      find: (id) =>
        findOne(id).pipe(
          Effect.map((found) => (found._tag === "Some" ? found.value : undefined)),
          Effect.mapError(unavailable("The Booking could not be read")),
        ),
      insert: Effect.fn("BookingStore.postgres.insert")(function* insert(booking: Booking) {
        yield* UnitOfWork.required;
        const written = yield* insertOne(booking).pipe(
          Effect.mapError(unavailable("The Booking could not be written")),
        );
        return written.length > 0;
      }),
      transition: Effect.fn("BookingStore.postgres.transition")(function* transition(
        id: string,
        from: BookingStatus,
        to: BookingStatus,
      ) {
        yield* UnitOfWork.required;
        const moved = yield* moveOne({ id, from, to }).pipe(
          Effect.mapError(unavailable("The Booking status could not be written")),
        );
        return moved.length > 0;
      }),
    });
  }),
);
