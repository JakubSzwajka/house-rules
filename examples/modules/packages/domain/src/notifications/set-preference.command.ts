import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
import { Preference } from "./notification.ts";

export class PreferenceSet extends Domain.Event("PreferenceSet", {
  ...Preference.fields,
  by: Schema.String,
  for: ActedFor,
}) {}

export class SetPreference extends Domain.Command("SetPreference", {
  target: PersonId,
  middleware: [Session],
  input: Preference.fields,
  events: [PreferenceSet],
  rejects: [Forbidden, NotInboxOwner],
}) {}
