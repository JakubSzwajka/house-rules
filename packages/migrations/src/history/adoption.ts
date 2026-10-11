import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import {
  type AdoptionReport,
  type MigrationAdoption,
  MigrationFailed,
  type MigrationModule,
} from "../migration/migration.ts";

type Adopter = MigrationModule & Readonly<{ adopt: MigrationAdoption }>;

type OldRow = Readonly<{ migrationId: number; name: string }>;

const isAdopter = (module: MigrationModule): module is Adopter => module.adopt !== undefined;

const label = (row: OldRow) => ({ id: row.migrationId, name: row.name });

const readOldTable = Effect.fnUntraced(function* readOldTable(sql: SqlClient, from: string) {
  const [found] = yield* sql<{
    exists: boolean;
  }>`select to_regclass(${from}) is not null as exists`;
  if (found?.exists !== true) return undefined;
  const rows = yield* sql<OldRow>`select migration_id as "migrationId", name
    from ${sql(from)} order by migration_id`;
  return rows.map((row) => ({ migrationId: Number(row.migrationId), name: row.name }));
});

export const adoptHistories = Effect.fnUntraced(function* adoptHistories(
  sql: SqlClient,
  modules: ReadonlyArray<MigrationModule>,
) {
  const adopters = modules.filter(isAdopter);
  // Only a module whose history is empty adopts, so a second run adopts nothing.
  const reports = new Map<string, AdoptionReport>();
  const pending: Array<Adopter> = [];
  for (const module of adopters) {
    reports.set(module.name, { from: module.adopt.from, adopted: [], rehashed: [] });
    const [history] = yield* sql<{ empty: boolean }>`select not exists
      (select 1 from ${sql(module.table)}) as empty`;
    if (history?.empty === true) pending.push(module);
  }

  const plans: Array<Readonly<{ module: Adopter; rows: ReadonlyArray<OldRow> }>> = [];
  for (const from of new Set(pending.map((module) => module.adopt.from))) {
    const rows = yield* readOldTable(sql, from);
    // No old table: a fresh database, where every module applies its files from the start.
    if (rows === undefined) continue;
    const claimants = adopters.filter((module) => module.adopt.from === from);
    const unclaimed = rows.find(
      (row) => !claimants.some((module) => module.adopt.ids.includes(row.migrationId)),
    );
    if (unclaimed !== undefined) {
      return yield* new MigrationFailed({
        message: `Adopting from ${from}: migration ${unclaimed.migrationId}_${unclaimed.name} is claimed by no module. Add its id to one module's "adopt.ids".`,
      });
    }
    for (const module of claimants) {
      const missing = module.adopt.ids.find((id) => !rows.some((row) => row.migrationId === id));
      if (missing !== undefined) {
        return yield* new MigrationFailed({
          message: `Module ${module.name}: adopts migration ${missing} from ${from}, which ${from} does not hold.`,
        });
      }
    }
    for (const module of pending.filter((candidate) => candidate.adopt.from === from)) {
      plans.push({
        module,
        rows: rows.filter((row) => module.adopt.ids.includes(row.migrationId)),
      });
    }
  }

  // Writes start only after every old table passed its checks. The old table is only read.
  for (const { module, rows } of plans) {
    const { from, rehash = [] } = module.adopt;
    for (const row of rows) {
      // A rehashed row loses its digest, so checkApplied backfills it from today's file.
      const dropDigest = rehash.includes(row.migrationId);
      yield* sql`insert into ${sql(module.table)} (migration_id, created_at, name, sha256)
        select migration_id, created_at, name,
          case when ${dropDigest}::boolean then null else to_jsonb(old) ->> 'sha256' end
        from ${sql(from)} as old where migration_id = ${row.migrationId}`;
    }
    reports.set(module.name, {
      from,
      adopted: rows.map(label),
      rehashed: rows.filter((row) => rehash.includes(row.migrationId)).map(label),
    });
  }
  return reports;
});
