import { defineContract } from "@house-rules/application/contract";
import { ActorId } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { PartyPermissions } from "./person/permissions.js";
import {
  Person,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "./person/person.js";

export {
  DisplayName,
  Person,
  PersonAlreadyExists,
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "./person/person.js";
export { type PartyPermission, PartyPermissions } from "./person/permissions.js";

export const showPerson = defineContract("show_person", {
  description: "Show one person's display name by id.",
  input: Schema.Struct({ id: ActorId }),
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  annotations: { readOnly: true },
});
export const showMe = defineContract("show_me", {
  description: "Show the signed-in person: their id and display name.",
  input: Schema.Struct({}),
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  annotations: { readOnly: true },
});
export const renamePerson = defineContract("rename_person", {
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
  transactional: true,
});
