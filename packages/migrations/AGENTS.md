# @house-rules/migrations: notes for agents

## What it does

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

2. [ ] Add a migrate entry that runs `Migrations.script("migrations.json")` with a `SqlClient` and the Node platform layer. Run it before the app starts.
3. [ ] In a module's Postgres tests, use `MigrationsTesting.database({ label, client })` and `Migrations.run([...])`. Each test file gets its own database.

No layer goes into the app runtime. It owns no tables of its own beyond the history tables.

## Options

| Entry key | Meaning |
| --- | --- |
| `workspace` | a workspace folder; its migrations sit in `<folder>/migrations/` |
| `package` | an installed package that declares `"houseRules": { "migrations": "<folder>" }` and ships that folder in `files` |
| `name` | optional module name for the report |
| `table` | optional history table, default `<name>_migrations` |

Files are named `<id>_<name>.sql`. `--> statement-breakpoint` splits statements.

## Fixed rules

- Never edit, rename or remove an applied migration. Add a new file with a higher id.
- A module's SQL names only its own tables. No cross-module foreign keys.
- `house-rules-migrations` in `@house-rules/rules` fails when a module with migrations is missing from `migrations.json`.
- Any failure rolls back the whole run.
