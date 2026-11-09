import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { PersonId, ActedFor } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { EmailAddress } from "../delivery/email.external.ts";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class EmailAddressSet extends Domain.Event("EmailAddressSet", {
  address: Schema.NullOr(EmailAddress),
  by: Schema.String,
  for: ActedFor,
}) {}

export class SetEmailAddress extends Domain.Command("SetEmailAddress", {
  target: PersonId,
  middleware: [Session],
  input: { address: Schema.NullOr(EmailAddress) },
  events: [EmailAddressSet],
  rejects: [Forbidden, NotInboxOwner],
}) {}
