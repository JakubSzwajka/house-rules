import { ActorId, defineOperation, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  OrganisationRelation,
  PartyDenied,
  PartyNotFound,
  PartyUnavailable,
} from "../organisation/organisation.js";
import { AccessOperations } from "../role/operations.js";
import { PartyPermissions } from "./permissions.js";
import {
  Person,
  PersonAlreadyExists,
  PersonCallerDenied,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "./person.js";

const createPerson = defineOperation("Party.createPerson", {
  description: "Create a person during trusted account setup.",
  input: Schema.Struct({ displayName: Schema.String, id: Schema.optionalKey(ActorId) }),
  output: Person,
  failure: Schema.Union([
    PersonAlreadyExists,
    PersonCallerDenied,
    PersonInputInvalid,
    PersonStoreUnavailable,
  ]),
  permission: "party:create",
  edges: [],
  transactional: true,
});
const showPerson = defineOperation("Party.showPerson", {
  description: "Show one person's display name by id.",
  input: Schema.Struct({ id: ActorId }),
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  edges: [],
  readOnly: true,
});
const showMe = defineOperation("Party.showMe", {
  description: "Show the signed-in person: their id and display name.",
  input: NoInput,
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  edges: [],
  readOnly: true,
});
const renamePerson = defineOperation("Party.renamePerson", {
  description: "Change your own display name.",
  input: Schema.Struct({ id: ActorId, displayName: Schema.String }),
  output: Person,
  failure: Schema.Union([
    PersonInputInvalid,
    PersonNotFound,
    PersonUpdateRefused,
    PersonStoreUnavailable,
  ]),
  permission: PartyPermissions.update,
  edges: [],
  transactional: true,
});

const listPeople = defineOperation("Party.listPeople", {
  description:
    "List everyone for global admins, or only your organisations' staff for scoped admins.",
  input: NoInput,
  output: Schema.Array(
    Schema.Struct({
      ...Person.fields,
      assignments: Schema.Array(
        Schema.Struct({
          roleKey: Schema.String,
          roleName: Schema.String,
          organisationId: Schema.NullOr(Schema.String),
          organisationName: Schema.NullOr(Schema.String),
        }),
      ),
      organisations: Schema.Array(OrganisationRelation),
    }),
  ),
  failure: Schema.Union([PartyDenied, PartyUnavailable]),
  permission: "party:admin",
  readOnly: true,
});
const listMembers = defineOperation("Party.listMembers", {
  description: "List an organisation's members and scoped roles only when you administer it.",
  input: Schema.Struct({ organisationId: Schema.String }),
  output: Schema.Array(
    Schema.Struct({
      ...Person.fields,
      relation: Schema.NullOr(Schema.String),
      roles: Schema.Array(Schema.Struct({ roleKey: Schema.String, roleName: Schema.String })),
    }),
  ),
  failure: Schema.Union([PartyNotFound, PartyUnavailable]),
  permission: "party:read",
  readOnly: true,
});
export const PartyOperations = {
  listMembers,
  listPeople,
  createPerson,
  showPerson,
  showMe,
  renamePerson,
  ...AccessOperations,
} as const;
