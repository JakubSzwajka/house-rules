import { AuditReader } from "@house-rules/call-audit";
import { Effect, Layer } from "effect";
import { AuditTrail } from "../../storage.ts";
import { AuditUnavailable } from "../../contract.ts";
export const auditTrailReader = Layer.effect(
  AuditTrail,
  Effect.gen(function* () {
    const reader = yield* AuditReader;
    return {
      recent: (personId: string) =>
        reader.readRows({ viewerId: personId, limit: 50 }).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              feature: row.target,
              outcome: row.outcome,
              requestId: row.requestId ?? null,
              ms: row.ms,
            })),
          ),
          Effect.mapError(() => new AuditUnavailable()),
        ),
    };
  }),
);
