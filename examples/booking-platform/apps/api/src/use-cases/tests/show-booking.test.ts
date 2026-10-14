import { BookingPermissions, Bookings, showBookingContract } from "@example/bookings";
import { expect, it } from "@effect/vitest";
import { Forbidden, Grant } from "@house-rules/application";
import { Effect, Layer } from "effect";
import { showBooking } from "../show-booking.js";

const bookings = Bookings.fromRecords([
  { id: "b-1", guestName: "Ada", ownerId: "actor-a", status: "active" },
]);

it.layer(Layer.merge(bookings, Grant.layerFromPermissions([BookingPermissions.read])))(
  "showBooking",
  (test) => {
    test.effect("returns the booking", () =>
      Effect.gen(function* returnsBooking() {
        expect(yield* showBooking.handler({ id: "b-1" })).toEqual({
          id: "b-1",
          guestName: "Ada",
          status: "active",
        });
      }),
    );

    test.effect("keeps BookingNotFound in the error channel", () =>
      Effect.gen(function* keepsTypedError() {
        const error = yield* Effect.flip(showBooking.handler({ id: "missing" }));

        expect(error._tag).toBe("BookingNotFound");
      }),
    );

    test.effect("is a read-only capability that needs bookings:read and no approval", () =>
      Effect.sync(() => {
        expect(showBooking.contract).toBe(showBookingContract);
        expect(showBookingContract.name).toBe("show_booking");
        expect(showBookingContract.annotations).toEqual({ readOnly: true, destructive: false });
        expect(showBookingContract.permission).toBe("bookings:read");
        expect(showBookingContract.needsApproval).toBe(false);
      }),
    );
  },
);

it.layer(Layer.merge(bookings, Grant.denyAll))("showBooking without bookings:read", (test) => {
  test.effect("fails with Forbidden", () =>
    Effect.gen(function* failsForbidden() {
      const error = yield* Effect.flip(showBooking.handler({ id: "b-1" }));

      expect(error).toEqual(
        new Forbidden({ capabilityName: "show_booking", permission: "bookings:read" }),
      );
    }),
  );
});
