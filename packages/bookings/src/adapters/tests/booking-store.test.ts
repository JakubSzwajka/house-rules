import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/capability";
import { Effect, Schema } from "effect";
import { BookingAlreadyExists, BookingNotFound, Bookings, BookingStore } from "../../index.js";
import { stores } from "./stores.js";

class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}

const actorA = Actor.make({ id: ActorId.make("actor-a") });
const actorB = Actor.make({ id: ActorId.make("actor-b") });

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `BookingStore on ${name}`,
    (it) => {
      it.effect("finds nothing for an unknown id", () =>
        Effect.gen(function* findsNothing() {
          const store = yield* BookingStore;
          expect(yield* store.find("missing")).toBeUndefined();
        }),
      );

      it.effect("a write with no open unit fails with NoOpenUnit and leaves no row", () =>
        Effect.gen(function* noUnit() {
          const store = yield* BookingStore;
          const error = yield* Effect.flip(
            store.insert({ id: "no-unit", guestName: "Ada", ownerId: actorA.id }),
          );
          expect(error).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find("no-unit")).toBeUndefined();
        }),
      );

      it.effect("a write inside a unit commits and preserves the owner fact", () =>
        Effect.gen(function* commits() {
          const store = yield* BookingStore;
          const booking = { id: "committed", guestName: "Ada", ownerId: actorA.id };
          expect(yield* UnitOfWork.atomic(store.insert(booking))).toBe(true);
          expect(yield* store.find(booking.id)).toEqual(booking);
        }),
      );

      it.effect("the store keeps unowned legacy records as facts", () =>
        Effect.gen(function* unowned() {
          const store = yield* BookingStore;
          const booking = { id: "legacy", guestName: "Ada", ownerId: null };
          expect(yield* UnitOfWork.atomic(store.insert(booking))).toBe(true);
          expect(yield* store.find(booking.id)).toEqual(booking);
        }),
      );

      it.effect("a failure inside the unit rolls the write back", () =>
        Effect.gen(function* rollsBack() {
          const store = yield* BookingStore;
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              store
                .insert({ id: "rolled-back", guestName: "Ada", ownerId: actorA.id })
                .pipe(Effect.andThen(Effect.fail(new Boom()))),
            ),
          );
          expect(error).toBeInstanceOf(Boom);
          expect(yield* store.find("rolled-back")).toBeUndefined();
        }),
      );

      it.effect("a taken id writes nothing, and a later rollback keeps the first owner", () =>
        Effect.gen(function* takenId() {
          const store = yield* BookingStore;
          const first = { id: "taken", guestName: "Ada", ownerId: actorA.id };
          yield* UnitOfWork.atomic(store.insert(first));
          const exit = yield* Effect.flip(
            UnitOfWork.atomic(
              store.insert({ id: "taken", guestName: "Grace", ownerId: actorB.id }).pipe(
                Effect.tap((written) => Effect.sync(() => expect(written).toBe(false))),
                Effect.andThen(Effect.fail(new Boom())),
              ),
            ),
          );
          expect(exit).toBeInstanceOf(Boom);
          expect(yield* store.find("taken")).toEqual(first);
        }),
      );

      it.effect("Bookings reads and writes through the store and decides the actor relation", () =>
        Effect.gen(function* facade() {
          const bookings = yield* Bookings;
          const created = yield* UnitOfWork.atomic(
            bookings.create(actorA, { id: "via-facade", guestName: "Ada" }),
          );
          expect(created).toEqual({ id: "via-facade", guestName: "Ada", ownerId: actorA.id });
          expect(yield* bookings.get("via-facade")).toEqual(created);
          expect(yield* bookings.relation(actorA, "via-facade")).toBe("owner");
          expect(yield* bookings.relation(actorB, "via-facade")).toBe("none");
          expect(yield* bookings.relation(actorA, "nobody")).toBe("none");

          const store = yield* BookingStore;
          yield* UnitOfWork.atomic(
            store.insert({ id: "unowned-facade", guestName: "Grace", ownerId: null }),
          );
          expect(yield* bookings.relation(actorA, "unowned-facade")).toBe("none");
          expect(yield* bookings.relation(actorB, "unowned-facade")).toBe("none");

          const duplicate = yield* Effect.flip(
            UnitOfWork.atomic(bookings.create(actorB, { id: "via-facade", guestName: "Grace" })),
          );
          expect(duplicate).toEqual(new BookingAlreadyExists({ id: "via-facade" }));
          expect(yield* bookings.relation(actorA, "via-facade")).toBe("owner");

          const missing = yield* Effect.flip(bookings.get("nobody"));
          expect(missing).toEqual(new BookingNotFound({ id: "nobody" }));

          const noUnit = yield* Effect.flip(
            bookings.create(actorA, { id: "late", guestName: "Ada" }),
          );
          expect(noUnit).toBeInstanceOf(NoOpenUnit);
          expect(yield* bookings.relation(actorA, "late")).toBe("none");
        }).pipe(Effect.provide(Bookings.layer)),
      );
    },
  );
}
