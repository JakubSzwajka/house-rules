import type { CallKind } from "@house-rules/capability";
import { type Duration, type Effect, Schema } from "effect";

export type AuditEntry = Readonly<{
  capability: string;
  permission: string;
  viewerId: string | null;
  outcome: string;
  ms: number;
  kind?: CallKind | undefined;
  targetId?: string | null | undefined;
  channel?: string | undefined;
  requestId?: string | null | undefined;
}>;

export const AuditRow = Schema.Struct({
  capability: Schema.String,
  permission: Schema.String,
  viewerId: Schema.NullOr(Schema.String),
  outcome: Schema.String,
  ms: Schema.Finite,
  kind: Schema.optional(Schema.NullOr(Schema.Literals(["read", "write"]))),
  targetId: Schema.optional(Schema.NullOr(Schema.String)),
  channel: Schema.optional(Schema.NullOr(Schema.String)),
  requestId: Schema.optional(Schema.NullOr(Schema.String)),
  recordedAt: Schema.Date,
});
export type AuditRow = typeof AuditRow.Type;

export type ReadRowsOptions = Readonly<{
  limit?: number;
  viewerId?: string;
}>;

export class AuditReadFailed extends Schema.TaggedError<AuditReadFailed>()("AuditReadFailed", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class AuditStoreUnavailable extends Schema.TaggedError<AuditStoreUnavailable>()(
  "AuditStoreUnavailable",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type AuditClass = "read" | "write" | "failure";

export type AuditPolicy = Readonly<{
  keep: (entry: AuditEntry) => boolean;
  retention: Readonly<Record<AuditClass, Duration.Input>>;
  onWriteFailure: "ignore" | "log";
  erasure: "delete";
}>;

export type RetentionCutoffs = Readonly<Record<AuditClass, Date | null>>;

export type RetentionRun = Readonly<{
  ran: boolean;
  deleted: Readonly<Record<AuditClass, number>>;
}>;

export type CallAuditOptions = Readonly<{
  who: Effect.Effect<string | null>;
}>;

export type CallAuditTableOptions = CallAuditOptions &
  Readonly<{
    log?: boolean;
  }>;

export type RetentionOptions = Readonly<{
  interval?: Duration.Input;
  batchSize?: number;
}>;

export type CallAuditLayerOptions = CallAuditOptions &
  Readonly<{
    policy: AuditPolicy;
    log?: boolean;
    retention?: RetentionOptions;
  }>;
