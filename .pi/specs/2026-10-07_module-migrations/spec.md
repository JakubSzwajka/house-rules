# Module migrations, and a stored call audit

Asked by the owner on 2026-10-07, after CallWatch shipped: "do a migration round and hand off for my review". The goal is a stored audit trail (`CallAudit.layerTable`). That needs a framework migration runner first, because today Trippy runs one folder (`packages/trips/migrations`) into one history table (`db_migrations`), and a migration inside a framework package would never run. Work stays uncommitted for the owner's review, in both repos.

## Outcome

1. `@house-rules/migrations` (new framework package) runs migrations for many modules. Each module has its own folder and its own history table. It is plain Effect on `SqlClient`; the app provides the driver (Trippy: `@effect/sql-pg`).
2. The app declares its modules in one checked-in list. `house-rules-migrations` fails when a module with migrations is missing from it.
3. `@house-rules/call-audit` gets `CallAudit.layerTable` and its own migration. Trippy keeps the log line and gains the table.
4. Trippy runs on the new runner. Its five existing Trips migrations are adopted, not re-run.
5. `AGENTS.md` and the add-an-effect-module skill say: no ORM. Plain SQL through `SqlClient`, rows decoded with Schema, tests against real Postgres.

## Decisions

1. M1. The runner is a port of Trippy's verified `@trippy/db` migrate code (`packages/db/src/facade.ts` `migrate`, `src/internal/migration-files.ts`): file names `<id>_<name>.sql`, SHA-256 digest per file, digest check and backfill, `--> statement-breakpoint`, an advisory lock, one transaction per run, a report "verified / backfilled / applied" per module. It generalises that to a list of modules. It depends only on `effect` (`effect/unstable/sql`). Whether it can stay driver-free or needs `PgMigrator` from `@effect/sql-pg` is for the writer to find; adding `@effect/sql-pg` to the framework needs the owner's yes, so stop and ask.
2. M2. One history table per module, default `<module>_migrations`. A module entry may name an existing table, so Trips adopts `db_migrations` as-is: no data moves, nothing re-runs.
3. M3. The module list is data, not code: one JSON file at the app root (name chosen by the writer, e.g. `migrations.json`), with entries for workspace folders and for installed packages. A framework package declares its folder in its own `package.json` (a `houseRules.migrations` field) and lists that folder in `files`. Both the runner and the checker read the same list. The checker fails when a workspace package has a `migrations/` folder, or a dependency declares `houseRules.migrations`, and the list does not name it.
4. M4. Module SQL rules stay as they are: a module's migrations and SQL name only its own tables. `call-audit` owns its audit table. A framework package's migrations are checked like a workspace package's.
5. M5. `layerTable` writes one row per call, after the call, in `Effect.onExit`, with its failures swallowed like the log. Same five fields as the log line, plus a timestamp. It never stores input or error messages. Synchronous write; no background queue this round. No retention job this round; that is a TODO.
6. M6. Trippy's runtime role gets the new table through the existing default privileges (`docs/deploy-dokploy.md`), so no grant migration. The writer confirms this.
7. M7. The Docker image ships every module's folder to the migrator, not only Trips'.

## Acceptance

1. house-rules: `pnpm check` and `pnpm test` exit 0. Runner tests run against real Postgres (Trippy's `DbTesting` pattern), covering: two modules with separate tables; adopting an existing table without re-running; a digest mismatch fails and applies nothing; the checker fails on an unlisted module.
2. Trippy: `pnpm check`, `pnpm test` and the Next build exit 0, with the framework on temporary local `file:` pins (pins fail only on those). A test on a fresh database runs all modules; a test on a database that already has `db_migrations` with the five Trips rows applies only the call-audit migration. A web call writes one audit row.
3. The relevant TODO items are updated in both repos.

## Non-goals

- Retention or deletion of audit rows, an audit UI, a background write queue.
- `house-rules-migrations plan --from --to` (its own TODO item).
- Domain events or an outbox.
- Commit, push, PR or release before the owner approves.

## Log

- 2026-10-07: shipped. house-rules #21 (merge `be93217`): `@house-rules/migrations` 0.1.0, module-list check in `house-rules-migrations`, `CallAudit.layerTable` and `readRows`, `migrations.json`, no-ORM rule. Trippy #30 (merge `3613dce`), released as Trippy v0.15.0, `fx release verify` 5 of 5. Prod startup: trips (`db_migrations`) verified 1-5, applied none; call_audit applied `1_call_audit`. Infra PR #12 updates `fleet.yaml`. Cross-family review caught: duplicate history tables silently skipping a module, framework `src` SQL not checked, checker looser than runner (7 cases), `readRows` ordered by id, an adoption test seeded by the new runner, and a 5 s test connect timeout that flaked under load. Follow-ups: audit retention, an audit view, `implement` shielding calls from a broken watch.
