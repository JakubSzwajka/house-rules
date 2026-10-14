import { defineContract } from "@house-rules/application/contract";
import {
  PartyPermissions,
  Person,
  PersonNotFound,
  PersonStoreUnavailable,
} from "@house-rules/party/contract";
import { Schema } from "effect";

export const showMeContract = defineContract("show_me", {
  description: "Show the signed-in person: their id and display name.",
  input: Schema.Struct({}),
  output: Person,
  failure: Schema.Union([PersonNotFound, PersonStoreUnavailable]),
  permission: PartyPermissions.read,
  annotations: { readOnly: true },
});
