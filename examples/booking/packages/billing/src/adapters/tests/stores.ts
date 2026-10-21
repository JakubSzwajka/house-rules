import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryPaymentStore, postgresPaymentStore } from "../../index.ts";

const database = Layer.effectDiscard(
  Migrations.run([
    {
      name: "billing",
      table: "billing_migrations",
      directory: new URL("../../../migrations", import.meta.url).pathname,
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "billing",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

export const stores = [
  { name: "memory", layer: Layer.merge(memoryPaymentStore(), memoryUnitOfWork) },
  {
    name: "postgres",
    layer: Layer.merge(postgresPaymentStore, sqlUnitOfWork).pipe(Layer.provideMerge(database)),
  },
] as const;
