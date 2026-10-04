import { Bookings } from "@hosti/bookings";
import { expect, it } from "@effect/vitest";
import { Grant } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { bookingResponse, getBookingRoute } from "../get-booking-route.js";

const bookings = Bookings.fromRecords([{ id: "b-1", guestName: "Ada" }]);

it.layer(bookings)("getBookingRoute", (test) => {
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

it.layer(Layer.merge(bookings, Grant.denyAll))("bookingResponse without bookings:read", (test) => {
  test.effect("maps Forbidden to 403 before it reads the booking", () =>
    Effect.gen(function* answersForbidden() {
      expect(yield* bookingResponse("b-1")).toEqual({
        status: 403,
        body: "You may not read bookings.",
      });
      expect(yield* bookingResponse("missing")).toEqual({
        status: 403,
        body: "You may not read bookings.",
      });
    }),
  );
});
