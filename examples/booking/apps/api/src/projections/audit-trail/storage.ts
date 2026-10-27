import { Context, type Effect } from "effect";
import type { AuditEntry, AuditUnavailable } from "./contract.ts";
export class AuditTrail extends Context.Service<
  AuditTrail,
  {
    readonly recent: () => Effect.Effect<readonly (typeof AuditEntry.Type)[], AuditUnavailable>;
    readonly mine: (
      personId: string,
    ) => Effect.Effect<readonly (typeof AuditEntry.Type)[], AuditUnavailable>;
  }
>()("@example/api/read-models/audit-trail/AuditTrail") {}
