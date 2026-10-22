export { auditTrailReader } from "./adapters/service/audit-trail.ts";
import { Effect } from "effect";
import { AuditUnavailable } from "./contract.ts";
import { bindOperation } from "@house-rules/application";
import { AuditTrailOperations } from "./contract.ts";
import type { AuditTrail } from "./storage.ts";
export { AuditTrail } from "./storage.ts";
export const bindAuditTrail = (service: AuditTrail["Service"]) => [
  bindOperation(AuditTrailOperations.recent, () => service.recent()),
  bindOperation(AuditTrailOperations.mine, (_input, { caller }) =>
    caller.kind === "person" ? service.mine(caller.actor.id) : Effect.fail(new AuditUnavailable()),
  ),
];
