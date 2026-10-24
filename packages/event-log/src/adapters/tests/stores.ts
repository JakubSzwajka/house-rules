import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryEventStore, postgresEventStore } from "../../index.js";
const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "event_log",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "event_log_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "event_log",
        client: (url) => {
          // LISTEN reserves one connection; leave room for driver, producer and assertions.
          return PgClient.layer({ url, maxConnections: 4 });
        },
      }),
      NodeServices.layer,
    ),
  ),
);
export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresEventStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryEventStore(), memoryUnitOfWork) },
] as const;
