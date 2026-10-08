import {
  BookingPermissions,
  Bookings,
  BookingStore,
  BookingStoreUnavailable,
} from "@hosti/bookings";
import { expect, it } from "@effect/vitest";
import { Grant } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { getBookingRoute } from "../get-booking-route.js";

const bookings = Bookings.fromRecords([{ id: "b-1", guestName: "Ada" }]);
const reader = Grant.layerFromPermissions([BookingPermissions.read]);

it.layer(Layer.merge(bookings, reader))("getBookingRoute", (test) => {
  test.effect("answers 200 with the booking", () =>
    Effect.gen(function* answersOk() {
      expect(yield* getBookingRoute("b-1")).toEqual({ status: 200, body: "Ada (b-1)" });
    }),
  );

  test.effect("maps BookingNotFound to 404", () =>
    Effect.gen(function* answersNotFound() {
      expect(yield* getBookingRoute("missing")).toEqual({
        status: 404,
        body: "Booking missing was not found.",
      });
    }),
  );
});

it.layer(Layer.merge(bookings, Grant.denyAll))("getBookingRoute without bookings:read", (test) => {
  test.effect("maps Forbidden to 403 before it reads the booking", () =>
    Effect.gen(function* answersForbidden() {
      expect(yield* getBookingRoute("b-1")).toEqual({
        status: 403,
        body: "You may not read bookings.",
      });
      expect(yield* getBookingRoute("missing")).toEqual({
        status: 403,
        body: "You may not read bookings.",
      });
    }),
  );
});

const brokenStore = Layer.succeed(BookingStore, {
  find: () =>
    Effect.fail(new BookingStoreUnavailable({ message: "The Booking could not be read." })),
  insert: () => Effect.die("not used"),
});

it.layer(Layer.merge(Bookings.layer.pipe(Layer.provide(brokenStore)), reader))(
  "getBookingRoute with a broken store",
  (test) => {
    test.effect("maps BookingStoreUnavailable to 503", () =>
      Effect.gen(function* answersUnavailable() {
        expect(yield* getBookingRoute("b-1")).toEqual({
          status: 503,
          body: "Bookings are unavailable right now.",
        });
      }),
    );
  },
);
