import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryPersonStore, postgresPersonStore } from "../../index.js";

const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "party",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "party_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "party",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresPersonStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryPersonStore(), memoryUnitOfWork) },
] as const;
