import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { type AppliedMigration, MigrationFailed } from "../migration/migration.ts";
import type { MigrationFile } from "../migration/migration-files.ts";

export type AppliedCheck = Readonly<{
  verified: ReadonlyArray<AppliedMigration>;
  backfilled: ReadonlyArray<AppliedMigration>;
}>;

export const lockHistory = Effect.fnUntraced(function* lockHistory(sql: SqlClient, table: string) {
  // Keyed on the table name, so a runner that predates the module list queues here too.
  yield* sql`select pg_advisory_xact_lock(hashtextextended(${table}, 0))`;
  yield* sql`create table if not exists ${sql(table)} (
    migration_id integer primary key,
    created_at timestamptz not null default now(),
    name text not null,
    sha256 text
  )`;
  // A table made before digests existed gains the column; its rows backfill once.
  yield* sql`alter table ${sql(table)} add column if not exists sha256 text`;
});

const storeDigest = (sql: SqlClient, table: string, file: MigrationFile) =>
  sql`update ${sql(table)} set sha256 = ${file.sha256}
    where migration_id = ${file.id} and sha256 is null`;

export const checkApplied = Effect.fnUntraced(function* checkApplied(
  sql: SqlClient,
  module: string,
  table: string,
  files: ReadonlyArray<MigrationFile>,
) {
  const applied = yield* sql<{
    migrationId: number;
    name: string;
    sha256: string | null;
  }>`select migration_id as "migrationId", name, sha256 from ${sql(table)} order by migration_id`;
  const latest = applied.at(-1)?.migrationId ?? 0;
  const byId = new Map(applied.map((row) => [Number(row.migrationId), row]));
  const verified: Array<MigrationFile> = [];
  const backfill: Array<MigrationFile> = [];
  for (const row of applied) {
    const file = files.find((candidate) => candidate.id === row.migrationId);
    if (file === undefined || file.name !== row.name) {
      return yield* new MigrationFailed({
        message: `Module ${module}: applied migration ${row.migrationId}_${row.name} has no matching file.`,
      });
    }
    if (row.sha256 === null) {
      backfill.push(file);
    } else if (row.sha256 === file.sha256) {
      verified.push(file);
    } else {
      return yield* new MigrationFailed({
        message: `Module ${module}: applied migration ${file.id}_${file.name} was edited after it ran. Migrations are append-only.`,
      });
    }
  }
  for (const file of files) {
    if (file.id <= latest && !byId.has(file.id)) {
      return yield* new MigrationFailed({
        message: `Module ${module}: migration ${file.id}_${file.name} is older than the latest applied one. Migrations are append-only.`,
      });
    }
  }
  for (const file of backfill) {
    yield* storeDigest(sql, table, file);
  }
  const summary = (file: MigrationFile) => ({ id: file.id, name: file.name });
  return {
    verified: verified.map(summary),
    backfilled: backfill.map(summary),
  } satisfies AppliedCheck;
});

export const toMigrationRecord = (
  sql: SqlClient,
  table: string,
  files: ReadonlyArray<MigrationFile>,
): Record<string, Effect.Effect<void, SqlError>> =>
  Object.fromEntries(
    files.map((file) => [
      `${file.id}_${file.name}`,
      Effect.forEach(file.statements, (statement) => sql.unsafe(statement).unprepared, {
        discard: true,
      }).pipe(Effect.andThen(storeDigest(sql, table, file))),
    ]),
  );
