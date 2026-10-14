import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Bookings, postgresBookingStore } from "../../index.js";

const database = Layer.merge(
  MigrationsTesting.database({
    label: "booking_upgrade",
    client: (url) => PgClient.layer({ url, maxConnections: 2 }),
  }),
  NodeServices.layer,
);
const world = Bookings.layer.pipe(
  Layer.provide(postgresBookingStore),
  Layer.provideMerge(database),
);

layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
  "booking migration upgrade",
  (it) => {
    it.effect("keeps a booking seeded under 0001 unowned after 0002", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "bookings-upgrade-" });
        const source = new URL("../../../migrations", import.meta.url).pathname;
        yield* fs.copyFile(
          path.join(source, "0001_bookings.sql"),
          path.join(directory, "0001_bookings.sql"),
        );
        const module = { name: "bookings", directory, table: "bookings_migrations" };
        const first = yield* Migrations.run([module]);
        expect(first[0]?.applied).toEqual([{ id: 1, name: "bookings" }]);
        const sql = yield* SqlClient;
        yield* sql`insert into booking (id, guest_name) values ('legacy-upgrade', 'Ada')`;
        yield* fs.copyFile(
          path.join(source, "0002_booking_owner.sql"),
          path.join(directory, "0002_booking_owner.sql"),
        );
        const upgraded = yield* Migrations.run([module]);
        expect(upgraded[0]?.verified).toEqual([{ id: 1, name: "bookings" }]);
        expect(upgraded[0]?.applied).toEqual([{ id: 2, name: "booking_owner" }]);
        const bookings = yield* Bookings;
        expect(yield* bookings.get("legacy-upgrade")).toEqual({
          id: "legacy-upgrade",
          guestName: "Ada",
          ownerId: null,
        });
        const actor = Actor.make({ id: ActorId.make("a") });
        expect(yield* bookings.relation(actor, "legacy-upgrade")).toBe("none");
      }),
    );
  },
);
