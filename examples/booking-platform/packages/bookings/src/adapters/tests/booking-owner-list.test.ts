import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import { Bookings, BookingStore, myBookingsLimit } from "../../index.js";
import { stores } from "./stores.js";

const owner = Actor.make({ id: ActorId.make("owner-list-a") });
const other = Actor.make({ id: ActorId.make("owner-list-b") });

for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `BookingStore.listByOwner on ${name}`,
    (it) => {
      it.effect("lists only that owner's bookings, ordered by id", () =>
        Effect.gen(function* listsOwned() {
          const store = yield* BookingStore;
          const row = (id: string, ownerId: string | null) => ({
            id,
            guestName: `Guest ${id}`,
            ownerId,
            status: "active" as const,
          });
          yield* UnitOfWork.atomic(
            Effect.all([
              store.insert(row("list-b", owner.id)),
              store.insert(row("list-a", owner.id)),
              store.insert(row("list-c", other.id)),
              store.insert(row("list-d", null)),
            ]),
          );
          const mine = yield* store.listByOwner(owner.id, 10);
          expect(mine.map((booking) => booking.id)).toEqual(["list-a", "list-b"]);
          expect(mine[0]).toEqual(row("list-a", owner.id));
          expect((yield* store.listByOwner(other.id, 10)).map((booking) => booking.id)).toEqual([
            "list-c",
          ]);
          expect(yield* store.listByOwner("nobody", 10)).toEqual([]);
          expect((yield* store.listByOwner(owner.id, 1)).map((booking) => booking.id)).toEqual([
            "list-a",
          ]);
        }),
      );

      it.effect("Bookings.listMine shows the actor's own bookings and nobody else's", () =>
        Effect.gen(function* listMine() {
          const bookings = yield* Bookings;
          yield* UnitOfWork.atomic(bookings.create(owner, { id: "mine-1", guestName: "Ada" }));
          yield* UnitOfWork.atomic(bookings.create(other, { id: "theirs-1", guestName: "Grace" }));
          const mine = (yield* bookings.listMine(owner)).map((booking) => booking.id);
          expect(mine).toContain("mine-1");
          expect(mine).not.toContain("theirs-1");
          expect(mine.length).toBeLessThanOrEqual(myBookingsLimit);
          const theirs = (yield* bookings.listMine(other)).map((booking) => booking.id);
          expect(theirs).toEqual(["list-c", "theirs-1"]);
        }).pipe(Effect.provide(Bookings.layer)),
      );
    },
  );
}
