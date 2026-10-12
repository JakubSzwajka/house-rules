import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { appLayer } from "../../composition/app-layer.js";
import { showBooking } from "../show-booking.js";

it.layer(appLayer)("appLayer", (test) => {
  test.effect("provides every service and slot a use-case needs, and lets a visitor read", () =>
    Effect.gen(function* providesUseCaseServices() {
      const error = yield* Effect.flip(showBooking.handler({ id: "missing" }));

      expect(error._tag).toBe("BookingNotFound");
    }),
  );
});
