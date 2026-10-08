import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { clampLimit } from "../../audit/limits.ts";
import { AuditReadFailed, AuditRow, type ReadRowsOptions } from "../../audit/audit.ts";

export const readRows = (options: ReadRowsOptions = {}) =>
  Effect.gen(function* readAuditRows() {
    const sql = yield* SqlClient;
    const find = SqlSchema.findAll({
      Request: Schema.Struct({ limit: Schema.Finite, viewerId: Schema.NullOr(Schema.String) }),
      Result: AuditRow,
      execute: ({ limit, viewerId }) =>
        sql`select capability, permission, viewer_id as "viewerId", outcome, ms,
            kind, target_id as "targetId", channel, request_id as "requestId",
            recorded_at as "recordedAt"
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
