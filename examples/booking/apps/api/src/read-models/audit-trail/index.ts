export { auditTrailReader } from "./adapters/service/audit-trail.ts";
import { bindOperation } from "@house-rules/application";
import { AuditTrailOperations } from "./contract.ts";
import type { AuditTrail } from "./storage.ts";
export { AuditTrail } from "./storage.ts";
export const bindAuditTrail = (service: AuditTrail["Service"]) => [
  bindOperation(AuditTrailOperations.recent, (_input, { caller }) =>
    caller.kind === "person" ? service.recent(caller.actor.id) : service.recent(""),
  ),
];
