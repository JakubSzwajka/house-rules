import { Effect, Layer } from "effect";
import { auditClasses, clampBatchSize, clampLimit, noneDeleted } from "../../internal/limits.ts";
import { classOf } from "../../policy.ts";
import { AuditStore } from "../../storage.ts";
import type { AuditClass, AuditRow, RetentionCutoffs } from "../../types.ts";

const newestFirst = (left: AuditRow, right: AuditRow): number =>
  right.recordedAt.getTime() - left.recordedAt.getTime();

const withFacts = (row: AuditRow): AuditRow => ({
  ...row,
  kind: row.kind ?? null,
  targetId: row.targetId ?? null,
  channel: row.channel ?? null,
  requestId: row.requestId ?? null,
});

export const memoryAuditStore = (rows: Array<AuditRow> = []): Layer.Layer<AuditStore> =>
  Layer.sync(AuditStore, () => {
    let retentionRunning = false;
    const removeWhere = (doomed: (row: AuditRow) => boolean, limit: number): number => {
      const chosen = new Set(
        rows
          .filter(doomed)
          .sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime())
          .slice(0, limit),
      );
      const kept = rows.filter((row) => !chosen.has(row));
      rows.length = 0;
      rows.push(...kept);
      return chosen.size;
    };
    const deleteClass = (auditClass: AuditClass, cutoff: Date, batchSize: number) =>
      Effect.gen(function* deleteClassInBatches() {
        let total = 0;
        while (true) {
          const deleted = removeWhere(
            (row) => classOf(row) === auditClass && row.recordedAt.getTime() < cutoff.getTime(),
            batchSize,
          );
          total += deleted;
          if (deleted < batchSize) return total;
          // Yield between batches like a real store, so a second run can meet the held lock.
          yield* Effect.yieldNow;
        }
      });
    const runLocked = (cutoffs: RetentionCutoffs, batchSize: number) =>
      Effect.gen(function* deleteExpired() {
        const deleted: Record<AuditClass, number> = { ...noneDeleted };
        for (const auditClass of auditClasses) {
          const cutoff = cutoffs[auditClass];
          if (cutoff === null) continue;
          deleted[auditClass] = yield* deleteClass(auditClass, cutoff, batchSize);
        }
        return { ran: true, deleted };
      });
    return AuditStore.of({
      record: (row) => Effect.sync(() => void rows.push(row)),
      read: (options = {}) =>
        Effect.sync(() => {
          const filtered = rows
            .map((row, index) => ({ row, index }))
            .filter(
              ({ row }) => options.viewerId === undefined || row.viewerId === options.viewerId,
            )
            .sort((left, right) => newestFirst(left.row, right.row) || right.index - left.index);
          return filtered.slice(0, clampLimit(options.limit)).map(({ row }) => withFacts(row));
        }),
      deleteExpired: (cutoffs, batchSize) =>
        Effect.suspend(() => {
          if (retentionRunning) {
            return Effect.succeed({ ran: false, deleted: noneDeleted });
          }
          retentionRunning = true;
          return runLocked(cutoffs, clampBatchSize(batchSize)).pipe(
            Effect.ensuring(Effect.sync(() => void (retentionRunning = false))),
          );
        }),
      erase: (viewerId) =>
        Effect.sync(() =>
          removeWhere((row) => row.viewerId === viewerId, Number.POSITIVE_INFINITY),
        ),
    });
  });
