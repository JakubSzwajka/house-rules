import { Schema } from "effect";

export type AuditEntry = Readonly<{
  capability: string;
  permission: string;
  viewerId: string | null;
  outcome: string;
  ms: number;
}>;

export const AuditRow = Schema.Struct({
  capability: Schema.String,
  permission: Schema.String,
  viewerId: Schema.NullOr(Schema.String),
  outcome: Schema.String,
  ms: Schema.Finite,
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
