import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork, sqlUnitOfWork } from "@house-rules/capability";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryBookingStore, postgresBookingStore } from "../../index.js";

const migrationsDirectory = new URL("../../../migrations", import.meta.url).pathname;

const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    { name: "bookings", directory: migrationsDirectory, table: "bookings_migrations" },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "bookings",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

export const stores = [
  {
    name: "postgres",
    layer: Layer.mergeAll(postgresBookingStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryBookingStore(), memoryUnitOfWork) },
] as const;
