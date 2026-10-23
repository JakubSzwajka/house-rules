export { bindParty } from "./person/bind-party.js";
export { Party, type PartyFailure } from "./facade.js";
export { PartyStore, PersonStore } from "./storage.js";
import { Party } from "./facade.js";
import { PartyOperations } from "./contract.js";
import { bindParty } from "./person/bind-party.js";
import type { MountDefinition } from "@house-rules/application";
export const PartyMount = {
  map: { name: "party", kind: "package", package: "@house-rules/party" },
  service: Party,
  operations: Object.values(PartyOperations),
  bind: bindParty,
} satisfies MountDefinition<Party, Party["Service"]>;
export { memoryPartyStore } from "./adapters/memory/party.js";
export { postgresPartyStore } from "./adapters/postgres/party.js";
export {
  Assignment,
  Organisation,
  OrganisationId,
  PartyNotFound,
  PartyInputInvalid,
  PartyDenied,
  PartyConflict,
  PartyLastAdmin,
  PartyUnavailable,
  Relationship,
  PartyReference,
  Role,
  RoleKey,
  RolePermission,
  type BuiltInRoles,
  type PartyOptions,
} from "./contract.js";
export { personPolicy } from "./person/policy.js";
export { memoryPersonStore } from "./adapters/memory/person.js";
export { postgresPersonStore } from "./adapters/postgres/person.js";
export {
  DisplayName,
  type PartyPermission,
  PartyPermissions,
  Person,
  PersonAlreadyExists,
  PersonCallerDenied,
  PartyOperations,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "./contract.js";
