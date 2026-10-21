import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Layer } from "effect";

const modules = [
  {
    name: "bookings",
    directory: new URL("../migrations", import.meta.resolve("@example/bookings")).pathname,
  },
  {
    name: "billing",
    directory: new URL("../migrations", import.meta.resolve("@example/billing")).pathname,
  },
  ...(
    [
      ["party", "@house-rules/party"],
      ["identity", "@house-rules/identity"],
      ["call_audit", "@house-rules/call-audit"],
    ] as const
  ).map(([name, pkg]) => ({
    name,
    directory: new URL("../migrations", import.meta.resolve(pkg)).pathname,
  })),
];
export const databaseTesting = Layer.effectDiscard(
  Migrations.run(
    modules.map(({ name, directory }) => ({ name, directory, table: `${name}_migrations` })),
  ),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "acceptance",
        client: (url) => PgClient.layer({ url, maxConnections: 3 }),
      }),
      NodeServices.layer,
    ),
  ),
  Layer.orDie,
);
