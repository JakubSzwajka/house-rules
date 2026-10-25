import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryProjectStore, postgresProjectStore } from "../../index.js";
const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "projects",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "projects_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "projects",
        client: (url) => PgClient.layer({ url, maxConnections: 3 }),
      }),
      NodeServices.layer,
    ),
  ),
);
export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresProjectStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryProjectStore(), memoryUnitOfWork) },
] as const;
