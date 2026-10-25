import { ActorId, defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { PartyUnavailable } from "../organisation/organisation.js";
import { RoleKey } from "../role/role.js";
import {
  PersonAlreadyExists,
  PersonCallerDenied,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
} from "./person.js";
import {
  CreatePrincipal,
  CreatedPrincipal,
  DisabledPrincipal,
  Principal,
  PrincipalKind,
  PrincipalKindRefused,
  PrincipalDisabledRefused,
} from "./principal.js";

const createPrincipal = defineOperation("Party.createPrincipal", {
  description: "Create a person or agent principal during trusted provisioning.",
  input: CreatePrincipal,
  output: CreatedPrincipal,
  failure: Schema.Union([
    PersonAlreadyExists,
    PersonCallerDenied,
    PersonInputInvalid,
    PersonStoreUnavailable,
  ]),
  permission: "party:create",
  transactional: true,
});
const disable = defineOperation("Party.disable", {
  description: "Permanently disable a principal during trusted provisioning.",
  input: Schema.Struct({ id: ActorId }),
  output: DisabledPrincipal,
  failure: Schema.Union([PersonNotFound, PersonCallerDenied, PersonStoreUnavailable]),
  permission: "party:update",
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const lockActive = defineOperation("Party.lockActive", {
  description: "Lock an active principal of the requested kind until this unit ends.",
  input: Schema.Struct({ handle: Schema.String, kind: PrincipalKind }),
  output: Principal,
  failure: Schema.Union([
    PersonNotFound,
    PrincipalKindRefused,
    PrincipalDisabledRefused,
    PersonStoreUnavailable,
  ]),
  permission: "party:read",
  transactional: true,
});
const principalsByIds = defineOperation("Party.principalsByIds", {
  description: "Read principal names and standing for a person or system caller.",
  input: Schema.Struct({ ids: Schema.Array(ActorId) }),
  output: Schema.Array(Principal),
  failure: PersonStoreUnavailable,
  permission: "party:read",
  readOnly: true,
});
const findPrincipal = defineOperation("Party.findPrincipal", {
  description: "Find a principal by its exact handle, including disabled principals.",
  input: Schema.Struct({ handle: Schema.String }),
  output: Principal,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: "party:read",
  readOnly: true,
});
const holdersOf = defineOperation("Party.holdersOf", {
  description:
    "Read bounded principal ids assigned a role in one exact scope, global when omitted.",
  input: Schema.Struct({
    role: RoleKey,
    scope: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  }),
  output: Schema.Struct({ ids: Schema.Array(ActorId), truncated: Schema.Boolean }),
  failure: PartyUnavailable,
  permission: "party:read",
  readOnly: true,
});
export const PrincipalOperations = {
  createPrincipal,
  disable,
  lockActive,
  principalsByIds,
  findPrincipal,
  holdersOf,
} as const;
