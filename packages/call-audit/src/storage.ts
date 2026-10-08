import { Context, type Effect } from "effect";
import type {
  AuditReadFailed,
  AuditRow,
  AuditStoreUnavailable,
  ReadRowsOptions,
  RetentionCutoffs,
  RetentionRun,
} from "./audit/audit.ts";

export class AuditStore extends Context.Service<
  AuditStore,
  {
    readonly record: (row: AuditRow) => Effect.Effect<void, AuditStoreUnavailable>;
    readonly read: (
      options?: ReadRowsOptions,
    ) => Effect.Effect<ReadonlyArray<AuditRow>, AuditReadFailed>;
    readonly deleteExpired: (
      cutoffs: RetentionCutoffs,
      batchSize: number,
    ) => Effect.Effect<RetentionRun, AuditStoreUnavailable>;
    readonly erase: (viewerId: string) => Effect.Effect<number, AuditStoreUnavailable>;
  }
>()("@house-rules/call-audit/AuditStore") {}
