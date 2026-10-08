import { UnitOfWork } from "@house-rules/capability";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { BookingStore } from "../../storage.js";
import { BookingStoreUnavailable } from "../../store-unavailable.js";
import { Booking } from "../../types.js";

const unavailable = (message: string) => (cause: { readonly message: string }) =>
  new BookingStoreUnavailable({ message: `${message}: ${cause.message}`, cause });

export const postgresBookingStore: Layer.Layer<BookingStore, never, SqlClient> = Layer.effect(
  BookingStore,
  Effect.gen(function* postgresBookingStore() {
    const sql = yield* SqlClient;
    const findOne = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Booking,
      execute: (id) => sql`select id, guest_name as "guestName" from booking where id = ${id}`,
    });
    // Returns the id when the row was written, and no row when the id is taken.
    const insertOne = SqlSchema.findAll({
      Request: Booking,
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ id, guestName }) =>
        sql`insert into booking (id, guest_name) values (${id}, ${guestName})
          on conflict (id) do nothing returning id`,
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
    });
  }),
);
