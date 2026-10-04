import { Bookings } from "@hosti/bookings";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { showBooking, showBookingContract } from "../show-booking.js";

it.layer(Bookings.fromRecords([{ id: "b-1", guestName: "Ada" }]))("showBooking", (test) => {
  test.effect("returns the booking", () =>
    Effect.gen(function* returnsBooking() {
      expect(yield* showBooking.handler({ id: "b-1" })).toEqual({ id: "b-1", guestName: "Ada" });
    }),
  );

  test.effect("keeps BookingNotFound in the error channel", () =>
    Effect.gen(function* keepsTypedError() {
      const error = yield* Effect.flip(showBooking.handler({ id: "missing" }));

      expect(error._tag).toBe("BookingNotFound");
    }),
  );

  test.effect("is a read-only capability", () =>
    Effect.sync(() => {
      expect(showBooking.contract).toBe(showBookingContract);
      expect(showBookingContract.name).toBe("show_booking");
      expect(showBookingContract.annotations).toEqual({ readOnly: true, destructive: false });
    }),
  );
});
