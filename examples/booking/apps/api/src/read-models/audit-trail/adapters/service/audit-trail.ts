import { AuditReader } from "@house-rules/call-audit";
import { Effect, Layer } from "effect";
import { AuditTrail } from "../../storage.ts";
import { AuditUnavailable } from "../../contract.ts";
export const auditTrailReader = Layer.effect(
  AuditTrail,
  Effect.gen(function* () {
    const reader = yield* AuditReader;
    const read = (viewerId?: string) =>
      reader.readRows(viewerId === undefined ? { limit: 50 } : { viewerId, limit: 50 }).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            feature: row.target,
            outcome: row.outcome,
            requestId: row.requestId ?? null,
            ms: row.ms,
            kind: row.kind ?? null,
          })),
        ),
        Effect.mapError(() => new AuditUnavailable()),
      );
    return { recent: () => read(), mine: (personId: string) => read(personId) };
  }),
);
