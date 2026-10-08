import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { showBooking } from "../../use-cases/show-booking.js";
import { appLayer } from "../app-layer.js";

it.layer(appLayer)("appLayer", (test) => {
  test.effect("provides every service and slot a use-case needs, and lets a visitor read", () =>
    Effect.gen(function* providesUseCaseServices() {
      const error = yield* Effect.flip(showBooking.handler({ id: "missing" }));

      expect(error._tag).toBe("BookingNotFound");
    }),
  );
});
