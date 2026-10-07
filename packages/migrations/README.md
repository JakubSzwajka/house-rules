# @house-rules/migrations

Runs the SQL migrations of many modules against one Postgres database. Each module keeps its own folder of `.sql` files and its own history table. It is a port of Trippy's `@trippy/db` runner, which runs in production, widened from one folder to a list.

It depends on `effect` only. The app provides the driver (`SqlClient`, for example from `@effect/sql-pg`) and the platform services (`FileSystem`, `Path`, `Crypto`, for example from `@effect/platform-node`).

## The module list

The app names every module it runs in one checked-in file, `migrations.json`, at the repository root:

```json
{
  "modules": [
    { "workspace": "packages/trips", "table": "db_migrations" },
    { "package": "@house-rules/call-audit" }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `workspace` | A workspace package folder, relative to the list. Its migrations sit in `<folder>/migrations/`, always. The runner refuses a workspace package whose `package.json` names another folder under `houseRules.migrations`. |
| `package` | An installed package. The runner finds it in `node_modules`, walking up from the list's folder, so the root `package.json` must depend on it. Its `package.json` must declare `"houseRules": { "migrations": "<folder>" }` and list that folder in `files`. |
| `name` | Optional. The module name in the report. Defaults to the folder name, or the package name without its scope, with `-` turned into `_`. |
| `table` | Optional. The history table. Defaults to `<name>_migrations`. Name an existing table to adopt it. |

Each entry names exactly one of `workspace` or `package`. Two entries may not share a name or a table, and `Migrations.run` refuses such a list built in code before it runs any SQL. `house-rules-migrations` in `@house-rules/rules` reads the same file and fails when a module with migrations is missing from it.

## Files

A migration file is named `<id>_<name>.sql`, such as `0001_call_audit.sql`, with `name` in `a-z`, `0-9` and `_`. A line `--> statement-breakpoint` splits a file into statements. Migrations are append-only: the runner fails when an applied file was edited, removed, or renamed, or when a new file has an id at or below the latest applied one.

## One run

1. Read every module's files and compute each file's SHA-256.
2. Open one transaction for the whole run.
3. Take a Postgres advisory lock per history table, in sorted order, so two runners queue instead of racing.
4. Create each history table if it is missing, and add the `sha256` column to an older table that has none.
5. Check every applied row against its file. A row with no digest gets one (backfilled). A row whose digest differs fails the run.
6. Apply the pending files of each module, in list order, through `Migrator` from `effect/unstable/sql`.

Any failure rolls back the whole run: no module applies or backfills anything. The run returns one report per module, and `Migrations.formatReport` turns it into one line per module:

```text
Migrations trips (db_migrations): digest verified 1_trips, 2_places; digest backfilled none; applied 3_spots.
Migrations call_audit (call_audit_migrations): digest verified none; digest backfilled none; applied 1_call_audit.
```

## Adopting a single-module table

Name the old table in the entry, as `{ "workspace": "packages/trips", "table": "db_migrations" }` does. The rows already there count as applied. The first run backfills any missing digests and applies only the files after them. No data moves.

## The migrate script

`Migrations.script(listFile)` reads the list, runs it, and logs the report lines. An app bundles a short entry around it:

```ts
// scripts/migrate.ts
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { Migrations } from "@house-rules/migrations";
import { Config, Effect, Layer } from "effect";

const database = Layer.unwrap(
  Effect.gen(function* migrationDatabase() {
    const url = yield* Config.Redacted("MIGRATION_DATABASE_URL");
    return PgClient.layer({ url, maxConnections: 2 });
  }),
);

Migrations.script("migrations.json").pipe(
  Effect.provide(Layer.merge(database, NodeServices.layer)),
  NodeRuntime.runMain,
);
```

The image that runs it needs the list and every module's migrations folder, at the same paths relative to the list.

`Migrations.readModuleList(listFile)` and `Migrations.run(modules)` are the two halves, for an app that builds its module list in code.

## Tests against a real Postgres

`MigrationsTesting.database({ label, client })` builds a `SqlClient` layer on a throwaway database. It reads `TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_NAMESPACE`, creates `test_<random>_<label>_<namespace>` when the layer builds, and drops it when the layer is released. It is driver-free too: `client` turns a URL into a `SqlClient` layer.

```ts
import { PgClient } from "@effect/sql-pg";
import { MigrationsTesting } from "@house-rules/migrations";

const database = MigrationsTesting.database({
  label: "trips",
  client: (url) => PgClient.layer({ url, maxConnections: 4 }),
});
```

In this repo, `docker compose up -d` starts the test server that the `.env.schema` defaults point at, and CI runs the same server as a service.
