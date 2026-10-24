# @house-rules/migrations

Version 0.3.0 peers on exact `effect` 4.0.3. Pin the Node platform and SQL driver to 4.0.3 too. Stable SQL imports use `effect/sql`.

Runs the SQL migrations of many modules against one Postgres database. Each module keeps its own folder of `.sql` files and its own history table. It is a port of Trippy's `@trippy/db` runner, which runs in production, widened from one folder to a list.

It depends on `effect` only. The app provides the driver (`SqlClient`, for example from `@effect/sql-pg`) and the platform services (`FileSystem`, `Path`, `Crypto`, for example from `@effect/platform-node`).

## SQL readiness

`SqlHealth.check(sqlClient)` runs `SELECT 1` on the app's existing client and returns an Effect with no requirements. It neither opens a unit nor runs migrations, and SQL tracing is disabled. `SqlHealth.fromContext(context)` returns that captured Effect in an Option, or None for apps with no client. In main, adapt a present check with `(signal) => Effect.runPromiseWith(context)(check, { signal })` for Node Host's named readiness checks. The host owns deadlines and only reports failed names; driver errors never become probe bodies. See [Node Host](../node-host/README.md#health-and-readiness).

## The module list

Domain modules are packages, never app folders. App areas are features, read-models, ways-in and composition. Folder locations are rejected; read models own no migrations.

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
| `adopt` | Optional. `{ "from": "<old table>", "ids": [...], "rehash"?: [...] }`: copy this module's rows out of an older, shared history table once. See [Splitting one history table into modules](#splitting-one-history-table-into-modules). |

Each entry names exactly one nonempty `workspace` or `package`. Two entries may not share a name, a table or a real folder identity, even across location kinds. For every location kind, the migrations directory cannot be a symlink or resolve outside its real module root. Workspace and installed-package module-root symlinks remain valid; only their migrations directory is constrained to that resolved root. `Migrations.run` also rejects duplicate names/tables in a code-built list before any SQL. Physical folder checks run while reading the module list. `house-rules-migrations` in `@house-rules/rules` reads the same file and fails when a module with migrations is missing from it.

## Files

A migration file is named `<id>_<name>.sql`, such as `0001_call_audit.sql`, with `name` in `a-z`, `0-9` and `_`. Every .sql file must be a regular file, not a symlink, even when the target stays inside the owner. Module-list acquisition and code-built Migrations.run lists both reject linked SQL files before executing SQL. The checker and runner consume the same file-link parity fixtures. A reserved line matching `^--> statement-breakpoint[ \t]*$` splits a file into trimmed nonempty chunks before SQL lexing, even inside quotes or comments. Semicolons alone do not split chunks. With the pinned Effect PostgreSQL driver each chunk must contain one command; unprepared execution still rejects multiple commands. The checker mirrors this private algorithm and both suites read the same chunk-parity fixture. Migrations are append-only: the runner fails when an applied file was edited, removed, or renamed, or when a new file has an id at or below the latest applied one.

## One run

1. Read every module's files and compute each file's SHA-256.
2. Open one transaction for the whole run, then first execute SET LOCAL standard_conforming_strings = on. The checker reserves the case-insensitive whole words standard_conforming_strings, backslash_quote, set_config and pg_settings anywhere in migration/read-model SQL, including literals, comments and dollar bodies.
3. Take a Postgres advisory lock per history table, and per table named in `adopt.from`, in sorted order, so two runners queue instead of racing.
4. Create each history table if it is missing, and add the `sha256` column to an older table that has none.
5. Copy the rows a module adopts, when its history is still empty.
6. Check every applied row against its file. A row with no digest gets one (backfilled). A row whose digest differs fails the run.
7. Apply the pending files of each module, in list order, through `Migrator` from `effect/sql`. Repeat SET LOCAL standard_conforming_strings = on before every migration chunk, including later files.

Any failure rolls back the whole run: no module applies or backfills anything. The run returns one report per module, and `Migrations.formatReport` turns it into one line per module:

```text
Migrations trips (db_migrations): digest verified 1_trips, 2_places; digest backfilled none; applied 3_spots.
Migrations call_audit (call_audit_migrations): digest verified none; digest backfilled none; applied 1_call_audit.
```

## Limits

The checker does not semantically analyse PL/pgSQL, DO bodies or dynamic EXECUTE; their ownership is a review rule. The runner executes SQL, not the checker policy, so run the checker before migrations. A SELECT-only database role granted access to published views is a planned follow-up, not implemented in phase 1.

## Adopting a single-module table

Name the old table in the entry, as `{ "workspace": "packages/trips", "table": "db_migrations" }` does. The rows already there count as applied. The first run backfills any missing digests and applies only the files after them. No data moves.

This works for one module. When the files of one table move into several modules, use `adopt` instead.

## Splitting one history table into modules

An app that grew up with one runner has one history table, say `db_migrations`, with rows 1 to 10. When its files move into modules, each module needs its own rows in its own table. Without them, the new run tries to apply file 1 again and fails. The `adopt` key copies the rows across, once:

```json
{
  "modules": [
    { "workspace": "packages/event-log", "adopt": { "from": "db_migrations", "ids": [1] } },
    { "workspace": "packages/identity", "adopt": { "from": "db_migrations", "ids": [2, 7] } },
    {
      "workspace": "packages/work",
      "adopt": { "from": "db_migrations", "ids": [3, 4, 5, 6, 8, 9, 10], "rehash": [4, 10] }
    }
  ]
}
```

Each module keeps its files with their old ids and names. The adoption and the migrations of the run happen in one transaction (Postgres DDL is transactional). If any step fails, such as a digest mismatch or a broken new file, the whole run rolls back: no history table, copied row, rehash, or applied file survives. In the run, after its locks:

1. The runner also locks the old table, so the old runner waits, if it takes the same advisory lock on that table. The lock is cooperative: it does not stop other SQL writers.
2. A module whose history table is empty, or new, adopts. A module with rows adopts nothing, so the second run and every run after it skip this step.
3. If the old table does not exist, as on a fresh database, nothing is adopted and every module applies its files from the start.
4. Otherwise the runner checks the old table before it copies any history row. It fails when the old table holds an id no module claims, or when a module claims an id the old table does not hold.
5. It copies each claimed row, `migration_id`, `name`, `created_at` and `sha256`, into the module's table. It only reads the old table: it never changes or drops it, so the old code still finds its history if you roll back to it.
6. The usual checks then run on the copied rows: the names must match the files, the digests must match, and new files must come after the latest id.

The module list checks the key before any SQL: `from` is a lowercase table name and no module's history table, `ids` is not empty and has no repeats, two modules never claim one id, and every `rehash` id is one of the module's `ids`.

`rehash` is for a file you had to edit on purpose while moving it, such as removing a foreign key to another module's table. The copy leaves that row's digest empty, and the run fills it from today's file, the same backfill an old table without digests gets. Only the ids you list are treated this way, only on the run that adopts, and it applies to adopted rows only. It is no lasting permission: a later edit of a listed file fails like any other. When the old table has no `sha256` column, every adopted row gets its digest from the current files, as for any old table without digests. An edited file you did not list fails the run, as before.

Why one key per module, and not one split map at the top of the list: each module states where its own history came from, next to its other settings, and a module added later needs no second place to edit. The cost is that the check for unclaimed ids looks across all entries with the same `from`.

The report shows what was adopted. `adoption` appears only on a module whose entry has `adopt`, so a list without the key reports exactly as before:

```text
Migrations work (work_migrations): adopted from db_migrations 3_work, 4_work_owner; rehashed 4_work_owner; digest verified 3_work; digest backfilled 4_work_owner; applied 11_task_links.
```

Leave the `adopt` key in the list. On a database that already adopted it does nothing, and on a fresh one it finds no old table.

## The migrate script

`Migrations.script(listFile)` reads the list, runs it, and logs the report lines. An app bundles a short script around it. It runs before `Runtime`, not through a feature or operation:

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
