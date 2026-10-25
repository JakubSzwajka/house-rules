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
          b.owner_id AS "ownerId", b.organisation_id AS "organisationId",
          p.status AS "paymentStatus", p.amount
          FROM booking_read b LEFT JOIN payment_read p
            ON p.booking_id = b.id AND p.owner_id = b.owner_id
          WHERE b.owner_id = ${personId} OR EXISTS (
            SELECT s.person_id FROM party_staff_read s
            WHERE s.person_id = ${personId} AND s.organisation_id = b.organisation_id
          )
          ORDER BY b.id`;
          return yield* Schema.decodeUnknownEffect(Schema.Array(MyBooking))(rows);
        },
        Effect.mapError((cause) => new ReadUnavailable({ cause })),
      ),
    });
  }),
);
