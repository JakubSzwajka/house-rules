import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryBookingStore, postgresBookingStore } from "../../index.ts";

const database = Layer.effectDiscard(
  Migrations.run([
    {
      name: "bookings",
      table: "bookings_migrations",
      directory: new URL("../../../migrations", import.meta.url).pathname,
    },
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
  { name: "memory", layer: Layer.merge(memoryBookingStore(), memoryUnitOfWork) },
  {
    name: "postgres",
    layer: Layer.merge(postgresBookingStore, sqlUnitOfWork).pipe(Layer.provideMerge(database)),
  },
] as const;
