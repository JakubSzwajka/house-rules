export { auditTrailReader } from "./adapters/service/audit-trail.ts";
import { Effect } from "effect";
import { AuditUnavailable } from "./contract.ts";
import { bindOperation } from "@house-rules/application";
import { AuditTrailOperations } from "./contract.ts";
import { AuditTrail } from "./storage.ts";
import type { MountDefinition } from "@house-rules/application";
export { AuditTrail } from "./storage.ts";
export const bindAuditTrail = (service: AuditTrail["Service"]) => [
  bindOperation(AuditTrailOperations.recent, () => service.recent()),
  bindOperation(AuditTrailOperations.mine, (_input, { caller }) =>
    caller.kind === "person" ? service.mine(caller.actor.id) : Effect.fail(new AuditUnavailable()),
  ),
];
export const AuditTrailMount = {
  map: { name: "audit-trail", kind: "projection", package: "@example/api" },
  service: AuditTrail,
  operations: Object.values(AuditTrailOperations),
  bind: bindAuditTrail,
} satisfies MountDefinition<AuditTrail, AuditTrail["Service"]>;
