import { expect, it } from "@effect/vitest";
import {
  Actor,
  ActorId,
  memoryUnitOfWork,
  NoOpenUnit,
  UnitOfWork,
  Viewer,
} from "@house-rules/capability";
import { Effect } from "effect";
import { BookingAlreadyExists, Bookings } from "../index.js";

const actorA = Actor.make({ id: ActorId.make("actor-a") });
const actorB = Actor.make({ id: ActorId.make("actor-b") });
const records = [
  { id: "b-1", guestName: "Ada", ownerId: actorA.id },
  { id: "legacy", guestName: "Grace", ownerId: null },
];

it.layer(Bookings.fromRecords(records))("Bookings", (test) => {
  test.effect("returns a stored booking without needing a Viewer", () =>
    Effect.gen(function* returnsStoredBooking() {
      const bookings = yield* Bookings;
      expect(yield* bookings.get("b-1")).toEqual(records[0]);
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
        UnitOfWork.atomic(bookings.create(actorB, { id: "b-1", guestName: "Grace" })),
      );
      expect(error).toEqual(new BookingAlreadyExists({ id: "b-1" }));
      expect(yield* bookings.relation(actorA, "b-1")).toBe("owner");
      expect(yield* bookings.relation(actorB, "b-1")).toBe("none");
    }).pipe(Effect.provide(memoryUnitOfWork)),
  );

  test.effect("create needs a unit of work and leaves no row", () =>
    Effect.gen(function* createNeedsUnit() {
      const bookings = yield* Bookings;
      const error = yield* Effect.flip(
        bookings.create(actorA, { id: "no-unit", guestName: "Grace" }),
      );
      expect(error).toBeInstanceOf(NoOpenUnit);
      expect(yield* bookings.relation(actorA, "no-unit")).toBe("none");
    }),
  );

  test.effect(
    "actor B has no relation to actor A's booking; unknown and legacy rows are unowned",
    () =>
      Effect.gen(function* objectAccess() {
        const bookings = yield* Bookings;
        expect(yield* bookings.relation(actorA, "b-1")).toBe("owner");
        expect(yield* bookings.relation(actorB, "b-1")).toBe("none");
        for (const actor of [actorA, actorB]) {
          expect(yield* bookings.relation(actor, "legacy")).toBe("none");
          expect(yield* bookings.relation(actor, "missing")).toBe("none");
        }
      }),
  );

  test.effect("one built module serves two Viewers without keeping either identity", () =>
    Effect.gen(function* requestIdentity() {
      const bookings = yield* Bookings;
      const request = (id: string) =>
        Effect.gen(function* () {
          const actor = yield* Viewer;
          return yield* UnitOfWork.atomic(bookings.create(actor, { id, guestName: "Guest" }));
        });
      const a = yield* request("by-a").pipe(Effect.provideService(Viewer, actorA));
      const b = yield* request("by-b").pipe(Effect.provideService(Viewer, actorB));
      expect(a.ownerId).toBe(actorA.id);
      expect(b.ownerId).toBe(actorB.id);
      expect(yield* bookings.relation(actorA, b.id)).toBe("none");
      expect(yield* bookings.relation(actorB, a.id)).toBe("none");
      expect(yield* bookings.relation(actorA, a.id)).toBe("owner");
      expect(yield* bookings.relation(actorB, b.id)).toBe("owner");
    }).pipe(Effect.provide(memoryUnitOfWork)),
  );
});
