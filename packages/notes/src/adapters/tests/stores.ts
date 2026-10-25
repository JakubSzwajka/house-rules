import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { memoryNoteStore, postgresNoteStore } from "../../index.js";
const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "notes",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "notes_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "notes",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);
export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresNoteStore, sqlUnitOfWork).pipe(Layer.provideMerge(migratedDatabase)),
  },
  { name: "memory", layer: Layer.merge(memoryNoteStore(), memoryUnitOfWork) },
] as const;
