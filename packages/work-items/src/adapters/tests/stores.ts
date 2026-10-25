import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryWorkItemStore, postgresWorkItemStore } from "../../index.js";
const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "work_items",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "work_items_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "work_items",
        client: (url) => PgClient.layer({ url, maxConnections: 3 }),
      }),
      NodeServices.layer,
    ),
  ),
);
export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresWorkItemStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryWorkItemStore(), memoryUnitOfWork) },
] as const;
