import * as NodePlatform from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { Migrations } from "@house-rules/migrations";
import { Config, Effect, Layer } from "effect";
const database = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.Redacted("MIGRATION_DATABASE_URL");
    return PgClient.layer({ url, maxConnections: 2 });
  }),
);
Migrations.script(new URL("../../../../../migrations.json", import.meta.url).pathname).pipe(
  Effect.provide(Layer.merge(database, NodePlatform.NodeServices.layer)),
  NodePlatform.NodeRuntime.runMain,
);
