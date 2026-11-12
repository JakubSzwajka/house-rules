import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";
import { QuietHours } from "./quiet-hours.ts";

export class QuietHoursSet extends Domain.Event("QuietHoursSet", {
  quietHours: Schema.NullOr(QuietHours),
  by: Schema.String,
  for: ActedFor,
}) {}

export class SetQuietHours extends Domain.Command("SetQuietHours", {
  target: PersonId,
  middleware: [Session],
  input: { quietHours: Schema.NullOr(QuietHours) },
  events: [QuietHoursSet],
  rejects: [Forbidden, NotInboxOwner],
}) {}
