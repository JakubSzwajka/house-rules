import { ActorId, defineOperation, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { Assignment } from "../assignment/assignment.js";
import {
  Organisation,
  PartyConflict,
  PartyDenied,
  PartyInputInvalid,
  PartyNotFound,
  PartyUnavailable,
} from "../organisation/organisation.js";
import { Relationship } from "../relationship/relationship.js";
import { Role } from "./role.js";

const failure = Schema.Union([
  PartyConflict,
  PartyDenied,
  PartyInputInvalid,
  PartyNotFound,
  PartyUnavailable,
]);
const createOrganisation = defineOperation("Party.createOrganisation", {
  description: "Create an organisation.",
  input: Organisation,
  output: Organisation,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
});
const showOrganisation = defineOperation("Party.showOrganisation", {
  description: "Show an organisation.",
  input: Schema.Struct({ id: Schema.String }),
  output: Organisation,
  failure,
  permission: "party:read",
  edges: [],
  readOnly: true,
});
const relate = defineOperation("Party.relate", {
  description: "Relate two parties.",
  input: Relationship,
  output: Schema.Void,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
});
const unrelate = defineOperation("Party.unrelate", {
  description: "Remove a relationship.",
  input: Relationship,
  output: Schema.Void,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const isRelated = defineOperation("Party.isRelated", {
  description: "Check a relationship between parties.",
  input: Relationship,
  output: Schema.Boolean,
  failure,
  permission: "party:read",
  edges: [],
  readOnly: true,
});
const defineRole = defineOperation("Party.defineRole", {
  description: "Create or update a custom role.",
  input: Schema.Struct({
    key: Schema.String,
    name: Schema.String,
    permissions: Schema.Array(Schema.String),
    organisationId: Schema.NullOr(Schema.String),
  }),
  output: Role,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
});
const deleteRole = defineOperation("Party.deleteRole", {
  description: "Delete a custom role and its assignments.",
  input: Schema.Struct({ key: Schema.String }),
  output: Schema.Void,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const listRoles = defineOperation("Party.listRoles", {
  description: "List built-in and custom roles.",
  input: NoInput,
  output: Schema.Array(Role),
  failure,
  permission: "party:read",
  edges: [],
  readOnly: true,
});
const assignRole = defineOperation("Party.assignRole", {
  description: "Assign a role as an administrator or trusted system setup.",
  input: Assignment,
  output: Schema.Void,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
});
const revokeRole = defineOperation("Party.revokeRole", {
  description: "Revoke a role assignment.",
  input: Assignment,
  output: Schema.Void,
  failure,
  permission: "party:admin",
  edges: [],
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const rolesOf = defineOperation("Party.rolesOf", {
  description: "Read a person's role assignments.",
  input: Schema.Struct({ personId: ActorId }),
  output: Schema.Array(Assignment),
  failure,
  permission: "party:read",
  edges: [],
  readOnly: true,
});
const myAccess = defineOperation("Party.myAccess", {
  description: "Read your own role assignments, effective permissions and the app catalogue.",
  input: NoInput,
  output: Schema.Struct({
    roles: Schema.Array(Assignment),
    permissions: Schema.Array(Schema.String),
    catalogue: Schema.Array(Schema.String),
  }),
  failure,
  permission: "party:read",
  edges: [],
  readOnly: true,
});
export const AccessOperations = {
  myAccess,
  createOrganisation,
  showOrganisation,
  relate,
  unrelate,
  isRelated,
  defineRole,
  deleteRole,
  listRoles,
  assignRole,
  revokeRole,
  rolesOf,
} as const;
