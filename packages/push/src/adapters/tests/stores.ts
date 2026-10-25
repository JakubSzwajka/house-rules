import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";
import { Push, type PushOptions, type PushSender } from "../../index.js";
import { memoryPushStore } from "../memory/push.js";
import { postgresPushStore } from "../postgres/push.js";
const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    {
      name: "push",
      directory: new URL("../../../migrations", import.meta.url).pathname,
      table: "push_migrations",
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "push",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);
export const pushStores = [
  {
    name: "postgres",
    facadeLayer: (options: PushOptions, sender: Layer.Layer<PushSender>) =>
      Push.layerPostgres(options, sender).pipe(Layer.provide(migratedDatabase)),
    layer: Layer.merge(postgresPushStore, sqlUnitOfWork).pipe(Layer.provideMerge(migratedDatabase)),
  },
  {
    name: "memory",
    facadeLayer: Push.layerMemory,
    layer: Layer.merge(memoryPushStore(), memoryUnitOfWork),
  },
] as const;
