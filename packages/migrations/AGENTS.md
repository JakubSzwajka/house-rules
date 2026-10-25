# @house-rules/migrations: notes for agents

Version 0.4.0 peers on exact `effect` 4.0.3. Pin the Node platform and SQL driver to 4.0.3 too. Stable SQL imports use `effect/sql`.

## What it does

Domain modules are packages, never app folders. App areas are features, read-models, ways-in and composition. The module list rejects folder locations; read models own no migrations.

It runs the SQL migrations of many modules against one Postgres database, in one transaction. Each module keeps its own `migrations/` folder and its own history table. Migrations are append-only and checked by SHA-256. It also gives tests a throwaway database. The full guide is `README.md` in this package.

## How an app mounts it

1. [ ] List every module in `migrations.json` at the repository root:

   ```json
   {
     "modules": [
       { "workspace": "packages/bookings" },
       { "package": "@house-rules/call-audit" }
     ]
   }
   ```

2. [ ] Add a migrate script that runs `Migrations.script("migrations.json")` with a `SqlClient` and the Node platform layer. Run it before the app starts.
3. [ ] In a module's Postgres tests, use `MigrationsTesting.database({ label, client })` and `Migrations.run([...])`. Each test file gets its own database.
   For a module's shared store suite, run `Migrations.run` over the module's own `migrations/` folder and provide `sqlUnitOfWork` from `@house-rules/application` beside it. `TEST_DATABASE_ADMIN_URL` must reach a Postgres server. In this repo `docker compose up -d` starts it.

No layer goes into the app's `Runtime`. Features and operations do not run migrations. It owns no tables of its own beyond the history tables.

`SqlHealth.check(sqlClient)` is a no-requirements Effect that pings the app's existing client with `SELECT 1`, outside units and without tracing. `SqlHealth.fromContext(context)` returns an optional captured check, None when no client is installed. Main adapts it to a named Node Host readiness runner with `(signal) => Effect.runPromiseWith(context)(check, { signal })`; the host enforces its timeout and exposes only a failed name, never SQL errors. This package's named adapter exemption owns the SQL import, not app main or Node Host.

## Options

| Entry key | Meaning |
| --- | --- |
| `workspace` | a workspace folder; its migrations sit in `<folder>/migrations/` |
| `package` | an installed package that declares `"houseRules": { "migrations": "<folder>" }` and ships that folder in `files` |
| `name` | optional module name for the report |
| `table` | optional history table, default `<name>_migrations` |
| `adopt` | optional `{ "from", "ids", "rehash"? }`: copy this module's rows out of an older shared history table once; see `README.md` |

Each entry has exactly one nonempty workspace or package location. Package names default to the slugged basename and history to `<name>_migrations`. Name, table and adoption validation is the same for all locations. Real folder identity must be unique across entries, even with different names or location kinds. For workspace and package entries, the migrations directory must not be a symlink or resolve outside its real module root. Normal workspace/installed module-root symlinks remain valid; check migrations against the resolved owner.

Files are named `<id>_<name>.sql`. Each .sql file must be regular, never a symlink, even when the target stays inside the owner. Both module-list acquisition and code-built runs enforce this before SQL. A reserved line `--> statement-breakpoint` with optional trailing spaces/tabs splits trimmed nonempty chunks before lexing, even inside quotes/comments. Semicolons do not split chunks. The pinned Effect PG driver accepts one command per chunk, even with unprepared execution. Runner and checker mirror the private split and share chunk fixtures.

## Fixed rules

- Never edit, rename or remove an applied migration. Add a new file with a higher id.
- A module's SQL names only its own tables and views. No cross-module foreign keys.
- `house-rules-migrations` in `@house-rules/rules` fails when a module with migrations is missing from `migrations.json`.
- The first statement inside the run's transaction and the statement before every migration chunk set standard_conforming_strings on with SET LOCAL. The checker bans the whole words standard_conforming_strings, backslash_quote, set_config and pg_settings anywhere in migration/read-model SQL, including literals, comments and dollar bodies. Use E/dollar quotes for backslashes in read-model/view-DDL strings.
- Any failure rolls back the whole run.
- Limits: the checker does not semantically analyse PL/pgSQL, DO bodies or dynamic EXECUTE; their ownership needs review. A SELECT-only role granted published views is a planned follow-up, not phase 1 implementation.
- `adopt` only reads the old table. Adoption and migrations run in one transaction (Postgres DDL is transactional), so a failure rolls back both.
- `rehash` lets a file edited on purpose pass only on the run that adopts its row, and only when the old row had a digest to compare. A later edit still fails.
