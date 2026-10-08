import { CallWatch } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { logLine, makeWatch } from "../../internal/watch.ts";
import type { AuditEntry, CallAuditTableOptions } from "../../types.ts";

export const layerTable = (options: CallAuditTableOptions) =>
  Layer.effect(
    CallWatch,
    Effect.gen(function* tableWatch() {
      const sql = yield* SqlClient;
      const insertRow = (entry: AuditEntry) =>
        sql`insert into call_audit (capability, permission, viewer_id, outcome, ms)
          values (${entry.capability}, ${entry.permission}, ${entry.viewerId}, ${entry.outcome}, ${Math.round(entry.ms)})`;
      return makeWatch(options.who, (entry) =>
        Effect.all(
          [
            // Each write is sandboxed on its own, so a broken table still leaves the log line.
            options.log === true ? Effect.ignoreCause(logLine(entry)) : Effect.void,
            Effect.ignoreCause(insertRow(entry)),
          ],
          { discard: true },
        ),
      );
    }),
  );
