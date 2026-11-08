import { BookingApi, BookingId } from "@example/booking-domain";
import { layer, PgForTests, testSchema } from "@house-rules/domain-postgres";
import { devTokens, PersonId, sessionClient } from "@house-rules/stack";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { DEV_TOKENS } from "../auth.ts";
import { bookingLive } from "../booking-live.ts";

const onPostgres = process.env["DOMAIN_STORE"] !== "memory";

const serverOn = (schema: string) =>
  bookingLive(devTokens(DEV_TOKENS)).pipe(
    Layer.provide(layer({ schema, pollInterval: "100 millis" })),
  );

const as = (token: string) => BookingApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

describe.skipIf(!onPostgres)("the booking server on Postgres", () => {
  it.live("keeps a paid booking across a restart", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const id = BookingId.make("restart-1");

      yield* Effect.gen(function* () {
        const ann = yield* as("ann-token");
        yield* ann.MakeBooking(id, { guestName: "Grace", amount: 100 });
      }).pipe(Effect.scoped, Effect.provide(serverOn(schema)));

      yield* Effect.gen(function* () {
        const ann = yield* as("ann-token");
        const row = yield* ann.MyBookings.get(PersonId.make("ann")).pipe(
          Effect.map((view) => view?.bookings.find((booking) => booking.bookingId === id)),
          Effect.filterOrFail((booking) => booking?.payment === "paid"),
          Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
        );
        expect(row).toMatchObject({ guestName: "Grace", status: "active", payment: "paid" });
        const again = yield* ann
          .MakeBooking(id, { guestName: "Grace", amount: 100 })
          .pipe(Effect.flip);
        expect(again._tag).toBe("BookingExists");
      }).pipe(Effect.scoped, Effect.provide(serverOn(schema)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});
