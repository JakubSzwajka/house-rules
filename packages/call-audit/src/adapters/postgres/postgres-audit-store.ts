import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { auditClasses, clampBatchSize, noneDeleted } from "../../audit/limits.ts";
import { AuditStore } from "../../storage.ts";
import {
  type AuditClass,
  AuditStoreUnavailable,
  type RetentionCutoffs,
  type RetentionRun,
} from "../../audit/audit.ts";
import { readRows } from "./read-rows.ts";

const unavailable = (message: string) => (cause: { readonly message: string }) =>
  new AuditStoreUnavailable({ message: `${message}: ${cause.message}`, cause });

const retentionLock = "hashtext('@house-rules/call-audit/retention')";

const classFilter: Readonly<Record<AuditClass, string>> = {
  read: "outcome = 'success' and kind = 'read'",
  write: "outcome = 'success' and kind is distinct from 'read'",
  failure: "outcome <> 'success'",
};

const deleteBatch = (auditClass: AuditClass): string =>
  `delete from call_audit where id in (
    select id from call_audit where recorded_at < $1 and ${classFilter[auditClass]}
    order by recorded_at, id limit $2
  ) returning id`;

const deleteClass = (
  connection: Connection,
  auditClass: AuditClass,
  cutoff: Date,
  batchSize: number,
) =>
  Effect.gen(function* deleteClassInBatches() {
    let total = 0;
    while (true) {
      const gone = yield* connection.execute(
        deleteBatch(auditClass),
        [cutoff, batchSize],
        undefined,
      );
      total += gone.length;
      if (gone.length < batchSize) return total;
    }
  });

const runOnLockedConnection = (
  connection: Connection,
  cutoffs: RetentionCutoffs,
  batchSize: number,
) =>
  Effect.gen(function* deleteExpiredRows() {
    const deleted: Record<AuditClass, number> = { ...noneDeleted };
    for (const auditClass of auditClasses) {
      const cutoff = cutoffs[auditClass];
      if (cutoff === null) continue;
      deleted[auditClass] = yield* deleteClass(connection, auditClass, cutoff, batchSize);
    }
    return { ran: true, deleted } satisfies RetentionRun;
  });

export const postgresAuditStore: Layer.Layer<AuditStore, never, SqlClient> = Layer.effect(
  AuditStore,
  Effect.gen(function* postgresAuditStore() {
    const sql = yield* SqlClient;
    const deleteExpired = (cutoffs: RetentionCutoffs, batchSize: number) =>
      Effect.scoped(
        Effect.gen(function* lockedRetention() {
          // A session lock lives on one connection, so the run reserves one and deletes on it.
          const connection = yield* sql.reserve;
          const held = yield* Effect.acquireRelease(
            connection
              .execute(`select pg_try_advisory_lock(${retentionLock}) as held`, [], undefined)
              .pipe(Effect.map((rows) => rows[0]?.held === true)),
            (locked) =>
              locked
                ? connection
                    .execute(`select pg_advisory_unlock(${retentionLock})`, [], undefined)
                    .pipe(Effect.ignore)
                : Effect.void,
          );
          if (!held) return { ran: false, deleted: noneDeleted } satisfies RetentionRun;
          return yield* runOnLockedConnection(connection, cutoffs, clampBatchSize(batchSize));
        }),
      ).pipe(Effect.mapError(unavailable("Deleting expired call_audit rows failed")));
    return AuditStore.of({
      record: (row) =>
        sql`insert into call_audit
            (capability, permission, viewer_id, outcome, ms, kind, target_id, channel, request_id, recorded_at)
          values (${row.capability}, ${row.permission}, ${row.viewerId}, ${row.outcome},
            ${Math.round(row.ms)}, ${row.kind ?? null}, ${row.targetId ?? null}, ${row.channel ?? null}, ${row.requestId ?? null},
            ${row.recordedAt})`.pipe(
          Effect.asVoid,
          Effect.mapError(unavailable("Writing call_audit failed")),
        ),
      read: (options) => readRows(options).pipe(Effect.provideService(SqlClient, sql)),
      deleteExpired,
      erase: (viewerId) =>
        sql`delete from call_audit where viewer_id = ${viewerId} returning id`.pipe(
          Effect.map((gone) => gone.length),
          Effect.mapError(unavailable("Erasing call_audit rows failed")),
        ),
    });
  }),
);
