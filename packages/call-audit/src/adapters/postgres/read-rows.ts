import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { AuditReadFailed, AuditRow, type ReadRowsOptions } from "../../types.ts";

export const defaultLimit = 100;
export const maxLimit = 1000;

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || Number.isNaN(limit)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.floor(limit)));
};

export const readRows = (options: ReadRowsOptions = {}) =>
  Effect.gen(function* readAuditRows() {
    const sql = yield* SqlClient;
    const find = SqlSchema.findAll({
      Request: Schema.Struct({ limit: Schema.Finite, viewerId: Schema.NullOr(Schema.String) }),
      Result: AuditRow,
      execute: ({ limit, viewerId }) =>
        sql`select capability, permission, viewer_id as "viewerId", outcome, ms, recorded_at as "recordedAt"
          from call_audit
          where ${viewerId === null ? sql`true` : sql`viewer_id = ${viewerId}`}
          order by recorded_at desc, id desc
          limit ${limit}`,
    });
    return yield* find({ limit: clampLimit(options.limit), viewerId: options.viewerId ?? null });
  }).pipe(
    Effect.mapError(
      (cause) =>
        new AuditReadFailed({ message: `Reading call_audit failed: ${cause.message}`, cause }),
    ),
  );
