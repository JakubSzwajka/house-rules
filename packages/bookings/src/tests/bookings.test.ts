import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/capability";
import { Effect } from "effect";
import { BookingAlreadyExists, Bookings } from "../index.js";

const records = [{ id: "b-1", guestName: "Ada" }];

it.layer(Bookings.fromRecords(records))("Bookings", (test) => {
  test.effect("returns a stored booking", () =>
    Effect.gen(function* returnsStoredBooking() {
      const bookings = yield* Bookings;

      const booking = yield* bookings.get("b-1");

      expect(booking).toEqual({ id: "b-1", guestName: "Ada" });
    }),
  );

  test.effect("fails with a typed BookingNotFound", () =>
    Effect.gen(function* failsWithBookingNotFound() {
      const bookings = yield* Bookings;

      const error = yield* Effect.flip(bookings.get("missing"));

      expect(error._tag).toBe("BookingNotFound");
      expect(error).toMatchObject({ id: "missing" });
    }),
  );

  test.effect("refuses to create a booking whose id is taken", () =>
    Effect.gen(function* refusesTakenId() {
      const bookings = yield* Bookings;

      const error = yield* Effect.flip(
        UnitOfWork.atomic(bookings.create({ id: "b-1", guestName: "Grace" })),
      );

      expect(error).toEqual(new BookingAlreadyExists({ id: "b-1" }));
    }).pipe(Effect.provide(memoryUnitOfWork)),
  );

  test.effect("create needs a unit of work", () =>
    Effect.gen(function* createNeedsUnit() {
      const bookings = yield* Bookings;

      const error = yield* Effect.flip(bookings.create({ id: "b-2", guestName: "Grace" }));

      expect(error).toBeInstanceOf(NoOpenUnit);
    }),
  );
});
