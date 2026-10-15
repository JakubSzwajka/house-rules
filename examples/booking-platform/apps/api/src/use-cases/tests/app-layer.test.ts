import { BookingPermissions } from "@example/bookings";
import { expect, it } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import { CurrentActor, Grant } from "@house-rules/application";
import { AuditStore } from "@house-rules/call-audit";
import { Effect } from "effect";
import { appLayer, memoryAppLayer } from "../../composition/app-layer.js";
import { bookBooking } from "../book-booking.js";
import { showBooking } from "../show-booking.js";

it.layer(appLayer)("appLayer", (test) => {
  test.effect("provides every service a use-case needs; the caller adds the Grant", () =>
    Effect.gen(function* providesUseCaseServices() {
      const error = yield* Effect.flip(
        showBooking
          .handler({ id: "missing" })
          .pipe(Effect.provideService(Grant, Grant.fromPermissions([BookingPermissions.read]))),
      );

      expect(error._tag).toBe("BookingNotFound");
    }),
  );
});

it.layer(memoryAppLayer())("call-audit on the CallWatch slot", (test) => {
  test.effect("records the actor's read as well as the write: the strict policy", () =>
    Effect.gen(function* records() {
      const actor = Actor.make({ id: ActorId.make("actor-a") });
      yield* bookBooking
        .handler({ id: "b-1", guestName: "Ada" })
        .pipe(
          Effect.provideService(CurrentActor, actor),
          Effect.provideService(Grant, Grant.fromPermissions([BookingPermissions.write])),
        );
      yield* showBooking
        .handler({ id: "b-1" })
        .pipe(
          Effect.provideService(CurrentActor, actor),
          Effect.provideService(Grant, Grant.fromPermissions([BookingPermissions.read])),
        );
      // The memory store's rows outlive one build of the layer, so read only this test's calls.
      const all = yield* (yield* AuditStore).read();
      const rows = all.filter((row) => row.viewerId === "actor-a");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        capability: "show_booking",
        permission: "bookings:read",
        outcome: "success",
        kind: "read",
      });
      expect(rows[1]).toMatchObject({
        capability: "book_booking",
        permission: "bookings:write",
        viewerId: "actor-a",
        outcome: "success",
        kind: "write",
        targetId: "b-1",
      });
    }),
  );
});
