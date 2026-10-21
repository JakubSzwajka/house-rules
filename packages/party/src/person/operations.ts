import { ActorId, defineOperation, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
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
const showPerson = defineOperation("show_person", {
  description: "Show one person's display name by id.",
  input: Schema.Struct({ id: ActorId }),
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  edges: [],
  readOnly: true,
});
const showMe = defineOperation("show_me", {
  description: "Show the signed-in person: their id and display name.",
  input: NoInput,
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  edges: [],
  readOnly: true,
});
const renamePerson = defineOperation("rename_person", {
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

export const PartyOperations = { createPerson, showPerson, showMe, renamePerson } as const;
