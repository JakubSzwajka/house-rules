import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { type AuditStore, memoryAuditStore, postgresAuditStore } from "../../index.ts";

const migrationsDirectory = new URL("../../../migrations", import.meta.url).pathname;

export const migratedDatabase = (label: string) =>
  Layer.effectDiscard(
    Migrations.run([
      { name: "call_audit", directory: migrationsDirectory, table: "call_audit_migrations" },
    ]),
  ).pipe(
    Layer.provideMerge(
      Layer.merge(
        MigrationsTesting.database({
          label,
          client: (url) => PgClient.layer({ url, maxConnections: 4 }),
        }),
        NodeServices.layer,
      ),
    ),
  );

const emptyTable = Layer.effectDiscard(SqlClient.use((sql) => sql`truncate call_audit`));

export type StoreUnderTest<R, E, E2> = {
  name: string;
  world: Layer.Layer<R, E>;
  fresh: () => Layer.Layer<AuditStore, E2, R>;
};

export const postgresStore = {
  name: "postgres",
  world: migratedDatabase("audit_store"),
  fresh: () => postgresAuditStore.pipe(Layer.provideMerge(emptyTable)),
};

export const memoryStore = {
  name: "memory",
  world: Layer.empty,
  fresh: () => memoryAuditStore(),
};
