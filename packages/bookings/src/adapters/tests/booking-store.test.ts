import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/capability";
import { Effect, Schema } from "effect";
import { BookingAlreadyExists, BookingNotFound, Bookings, BookingStore } from "../../index.js";
import { stores } from "./stores.js";

class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}

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
          const error = yield* Effect.flip(store.insert({ id: "no-unit", guestName: "Ada" }));
          expect(error).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find("no-unit")).toBeUndefined();
        }),
      );

      it.effect("a write inside a unit commits and reads back", () =>
        Effect.gen(function* commits() {
          const store = yield* BookingStore;
          const written = yield* UnitOfWork.atomic(
            store.insert({ id: "committed", guestName: "Ada" }),
          );
          expect(written).toBe(true);
          expect(yield* store.find("committed")).toEqual({ id: "committed", guestName: "Ada" });
        }),
      );

      it.effect("a failure inside the unit rolls the write back", () =>
        Effect.gen(function* rollsBack() {
          const store = yield* BookingStore;
          const error = yield* Effect.flip(
            UnitOfWork.atomic(
              store
                .insert({ id: "rolled-back", guestName: "Ada" })
                .pipe(Effect.andThen(Effect.fail(new Boom()))),
            ),
          );
          expect(error).toBeInstanceOf(Boom);
          expect(yield* store.find("rolled-back")).toBeUndefined();
        }),
      );

      it.effect("a taken id writes nothing, and a later rollback keeps the first row", () =>
        Effect.gen(function* takenId() {
          const store = yield* BookingStore;
          yield* UnitOfWork.atomic(store.insert({ id: "taken", guestName: "Ada" }));
          const exit = yield* Effect.flip(
            UnitOfWork.atomic(
              store.insert({ id: "taken", guestName: "Grace" }).pipe(
                Effect.tap((written) => Effect.sync(() => expect(written).toBe(false))),
                Effect.andThen(Effect.fail(new Boom())),
              ),
            ),
          );
          expect(exit).toBeInstanceOf(Boom);
          expect(yield* store.find("taken")).toEqual({ id: "taken", guestName: "Ada" });
        }),
      );

      it.effect("Bookings reads and writes through the store", () =>
        Effect.gen(function* facade() {
          const bookings = yield* Bookings;
          const created = yield* UnitOfWork.atomic(
            bookings.create({ id: "via-facade", guestName: "Ada" }),
          );
          expect(created).toEqual({ id: "via-facade", guestName: "Ada" });
          expect(yield* bookings.get("via-facade")).toEqual(created);

          const duplicate = yield* Effect.flip(
            UnitOfWork.atomic(bookings.create({ id: "via-facade", guestName: "Grace" })),
          );
          expect(duplicate).toEqual(new BookingAlreadyExists({ id: "via-facade" }));

          const missing = yield* Effect.flip(bookings.get("nobody"));
          expect(missing).toEqual(new BookingNotFound({ id: "nobody" }));

          const noUnit = yield* Effect.flip(bookings.create({ id: "late", guestName: "Ada" }));
          expect(noUnit).toBeInstanceOf(NoOpenUnit);
        }).pipe(Effect.provide(Bookings.layer)),
      );
    },
  );
}
