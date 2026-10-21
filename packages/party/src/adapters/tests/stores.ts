import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import {
  memoryPartyStore,
  postgresPartyStore,
  memoryPersonStore,
  postgresPersonStore,
} from "../../index.js";

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
    layer: Layer.mergeAll(postgresPersonStore, postgresPartyStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  {
    name: "memory",
    layer: Layer.mergeAll(memoryPersonStore(), memoryPartyStore(), memoryUnitOfWork),
  },
] as const;
