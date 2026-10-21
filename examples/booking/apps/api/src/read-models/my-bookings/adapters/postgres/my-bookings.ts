import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { MyBooking, ReadUnavailable } from "../../booking/my-bookings.ts";
import { MyBookingStore } from "../../storage.ts";

export const postgresMyBookingStore = Layer.effect(
  MyBookingStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return MyBookingStore.of({
      forPerson: Effect.fn("MyBookings.postgres.forPerson")(
        function* (personId: string) {
          const rows = yield* sql`SELECT b.id, b.guest_name AS "guestName", b.status,
          p.status AS "paymentStatus", p.amount
          FROM booking_read b JOIN payment_read p ON p.booking_id = b.id
          WHERE b.owner_id = ${personId} AND p.owner_id = ${personId}
          ORDER BY b.id`;
          return yield* Schema.decodeUnknownEffect(Schema.Array(MyBooking))(rows);
        },
        Effect.mapError((cause) => new ReadUnavailable({ cause })),
      ),
    });
  }),
);
