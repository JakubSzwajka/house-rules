import { BookingPermissions } from "@hosti/bookings";
import { expect, it } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import { CurrentActor, Grant } from "@house-rules/application";
import { AuditStore } from "@house-rules/call-audit";
import { Effect } from "effect";
import { appLayer, memoryAppLayer } from "../../composition/app-layer.js";
import { bookBooking } from "../book-booking.js";
import { showBooking } from "../show-booking.js";

it.layer(appLayer)("appLayer", (test) => {
  test.effect("provides every service and slot a use-case needs, and lets a visitor read", () =>
    Effect.gen(function* providesUseCaseServices() {
      const error = yield* Effect.flip(showBooking.handler({ id: "missing" }));

      expect(error._tag).toBe("BookingNotFound");
    }),
  );
});

it.layer(memoryAppLayer)("call-audit on the CallWatch slot", (test) => {
  test.effect("records the actor's write with its target, and keeps no visitor read off MCP", () =>
    Effect.gen(function* records() {
      const actor = Actor.make({ id: ActorId.make("actor-a") });
      yield* bookBooking
        .handler({ id: "b-1", guestName: "Ada" })
        .pipe(
          Effect.provideService(CurrentActor, actor),
          Effect.provideService(Grant, Grant.fromPermissions([BookingPermissions.write])),
        );
      yield* showBooking.handler({ id: "b-1" });
      // The memory store's rows outlive one build of the layer, so read only this test's calls.
      const all = yield* (yield* AuditStore).read();
      expect(
        all.some((row) => row.capability === "show_booking" && row.outcome === "success"),
      ).toBe(false);
      const rows = all.filter((row) => row.viewerId === "actor-a");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
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
