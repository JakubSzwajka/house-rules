import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { type Account, AccountId, memoryAccountStore, postgresAccountStore } from "../../index.js";

const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "accounts",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "accounts_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "accounts",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

export const stores = [
  {
    name: "postgres",
    unitsRunSideBySide: true,
    layer: Layer.merge(postgresAccountStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(migratedDatabase),
    ),
  },
  {
    name: "memory",
    unitsRunSideBySide: false,
    layer: Layer.merge(memoryAccountStore(), memoryUnitOfWork),
  },
] as const;

export const record = (id: string, email = `${id}@example.test`): Account => ({
  id: AccountId.make(id),
  email,
  displayName: "Ada Lovelace",
  password: { algorithm: "PBKDF2-SHA256", iterations: 600_000, salt: "c2FsdA==", hash: "aGFzaA==" },
  failedAttempts: 0,
  lockedUntil: null,
  createdAt: 1_700_000_000_123,
});
