import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { memoryUnitOfWork } from "@house-rules/domain";
import { sqlUnitOfWork } from "@house-rules/application";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import {
  Identity,
  type IdentityOptions,
  memoryBindingStore,
  postgresBindingStore,
} from "../../index.js";

export const identityDatabaseTesting = Layer.effectDiscard(
  Migrations.run([
    {
      name: "identity",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "identity_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "identity",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

export const identityWorldsTesting = (
  options: IdentityOptions,
  ports: Parameters<typeof Identity.layerMemory>[1] = {},
) =>
  [
    {
      name: "postgres",
      layer: Identity.layerPostgres(options, ports).pipe(
        Layer.provideMerge(sqlUnitOfWork),
        Layer.provideMerge(identityDatabaseTesting),
      ),
    },
    { name: "memory", layer: Layer.merge(Identity.layerMemory(options, ports), memoryUnitOfWork) },
  ] as const;

export const stores = [
  {
    name: "postgres",
    layer: Layer.merge(postgresBindingStore, sqlUnitOfWork).pipe(
      Layer.provideMerge(identityDatabaseTesting),
    ),
  },
  { name: "memory", layer: Layer.merge(memoryBindingStore(), memoryUnitOfWork) },
] as const;
