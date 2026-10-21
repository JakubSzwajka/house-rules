import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  Booking,
  BookingAlreadyExists,
  BookingNotFound,
  Bookings,
  BookingStore,
} from "../../index.ts";
import { stores } from "./stores.ts";

class AbortBooking extends Schema.TaggedError<AbortBooking>()("AbortBooking", {}) {}
const owner = Actor.make({ id: ActorId.make("owner-a") });
const other = Actor.make({ id: ActorId.make("owner-b") });
const row = (id: string): Booking => ({
  id,
  guestName: "Ada",
  ownerId: owner.id,
  status: "active",
});

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `v2 BookingStore on ${name}`,
    (it) => {
      it.effect("reads missing rows", () =>
        Effect.gen(function* () {
          expect(yield* (yield* BookingStore).find("absent")).toBeUndefined();
        }),
      );
      it.effect("rejects insert and transition outside a unit", () =>
        Effect.gen(function* () {
          const store = yield* BookingStore;
          expect(yield* Effect.flip(store.insert(row("no-unit")))).toBeInstanceOf(NoOpenUnit);
          expect(
            yield* Effect.flip(store.transition("absent", owner.id, "active", "cancelled")),
          ).toBeInstanceOf(NoOpenUnit);
          expect(yield* store.find("no-unit")).toBeUndefined();
        }),
      );
      it.effect("commits inserts and preserves ownership on duplicate", () =>
        Effect.gen(function* () {
          const store = yield* BookingStore;
          expect(yield* UnitOfWork.atomic(store.insert(row("committed")))).toBe(true);
          expect(
            yield* UnitOfWork.atomic(store.insert({ ...row("committed"), ownerId: other.id })),
          ).toBe(false);
          expect(yield* store.find("committed")).toEqual(row("committed"));
        }),
      );
      it.effect("rolls back multiple inserts and retains an existing row", () =>
        Effect.gen(function* () {
          const store = yield* BookingStore;
          yield* UnitOfWork.atomic(store.insert(row("retained")));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.insert(row("rolled-back-a"));
                  yield* store.insert(row("rolled-back-b"));
                  yield* store.insert({ ...row("retained"), ownerId: other.id });
                  return yield* new AbortBooking();
                }),
              ),
            ),
          ).toBeInstanceOf(AbortBooking);
          expect(yield* store.find("rolled-back-a")).toBeUndefined();
          expect(yield* store.find("rolled-back-b")).toBeUndefined();
          expect(yield* store.find("retained")).toEqual(row("retained"));
        }),
      );
      it.effect("guards transitions with owner and old status, and undoes a move", () =>
        Effect.gen(function* () {
          const store = yield* BookingStore;
          yield* UnitOfWork.atomic(store.insert(row("moving")));
          expect(
            yield* UnitOfWork.atomic(store.transition("moving", other.id, "active", "cancelled")),
          ).toBe(false);
          expect(
            yield* UnitOfWork.atomic(store.transition("absent", owner.id, "active", "cancelled")),
          ).toBe(false);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                store
                  .transition("moving", owner.id, "active", "cancelled")
                  .pipe(Effect.andThen(new AbortBooking())),
              ),
            ),
          ).toBeInstanceOf(AbortBooking);
          expect(yield* store.find("moving")).toEqual(row("moving"));
          expect(
            yield* UnitOfWork.atomic(store.transition("moving", owner.id, "active", "cancelled")),
          ).toBe(true);
          expect(
            yield* UnitOfWork.atomic(store.transition("moving", owner.id, "active", "cancelled")),
          ).toBe(false);
          expect(yield* store.find("moving")).toEqual({ ...row("moving"), status: "cancelled" });
        }),
      );
      it.effect("service hides another owner's booking on reads and cancels", () =>
        Effect.gen(function* () {
          const bookings = yield* Bookings;
          const created = yield* UnitOfWork.atomic(
            bookings.book(owner, { id: "private", guestName: "Ada" }),
          );
          expect(yield* bookings.get(owner, created.id)).toEqual(created);
          expect(yield* bookings.relation(owner, created.id)).toBe("owner");
          expect(yield* bookings.relation(other, created.id)).toBe("none");
          expect(yield* bookings.relation(owner, "absent")).toBe("none");
          expect(yield* Effect.flip(bookings.get(other, created.id))).toEqual(
            new BookingNotFound({ id: created.id }),
          );
          expect(yield* Effect.flip(bookings.get(owner, "absent"))).toEqual(
            new BookingNotFound({ id: "absent" }),
          );
          expect(yield* Effect.flip(UnitOfWork.atomic(bookings.cancel(other, created.id)))).toEqual(
            new BookingNotFound({ id: created.id }),
          );
          expect((yield* bookings.get(owner, created.id)).status).toBe("active");
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(bookings.book(other, { id: created.id, guestName: "Grace" })),
            ),
          ).toBeInstanceOf(BookingAlreadyExists);
        }).pipe(Effect.provide(Bookings.layer)),
      );
      it.effect("service cancels only an active owned booking and joins rollback", () =>
        Effect.gen(function* () {
          const bookings = yield* Bookings;
          expect(
            yield* Effect.flip(bookings.book(owner, { id: "service-no-unit", guestName: "Ada" })),
          ).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(bookings.cancel(owner, "absent"))).toBeInstanceOf(NoOpenUnit);
          yield* UnitOfWork.atomic(bookings.book(owner, { id: "cancel", guestName: "Ada" }));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                bookings.cancel(owner, "cancel").pipe(Effect.andThen(new AbortBooking())),
              ),
            ),
          ).toBeInstanceOf(AbortBooking);
          expect((yield* bookings.get(owner, "cancel")).status).toBe("active");
          expect((yield* UnitOfWork.atomic(bookings.cancel(owner, "cancel"))).status).toBe(
            "cancelled",
          );
          expect(yield* Effect.flip(UnitOfWork.atomic(bookings.cancel(owner, "cancel")))).toEqual(
            new BookingNotFound({ id: "cancel" }),
          );
          expect(yield* Effect.flip(UnitOfWork.atomic(bookings.cancel(owner, "absent")))).toEqual(
            new BookingNotFound({ id: "absent" }),
          );
        }).pipe(Effect.provide(Bookings.layer)),
      );
    },
  );
}

layer(stores[1].layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "v2 booking view",
  (it) => {
    it.effect("publishes the owned booking view", () =>
      Effect.gen(function* () {
        const store = yield* BookingStore;
        const sql = yield* SqlClient;
        yield* UnitOfWork.atomic(store.insert(row("published")));
        const published = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: Booking,
          execute: () =>
            sql`select id, guest_name as "guestName", owner_id as "ownerId", status from booking_read where id = 'published'`,
        })();
        expect(published).toEqual([row("published")]);
      }),
    );
  },
);
