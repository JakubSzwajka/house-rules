import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Delivery, Forbidden, PersonId, Session } from "@house-rules/stack";
import { NotInboxOwner } from "./not-inbox-owner.rejection.ts";

export class EmailAddressSet extends Domain.Event("EmailAddressSet", {
  address: Schema.NullOr(Delivery.EmailAddress),
  by: Schema.String,
  for: ActedFor,
}) {}

export class SetEmailAddress extends Domain.Command("SetEmailAddress", {
  target: PersonId,
  middleware: [Session],
  input: { address: Schema.NullOr(Delivery.EmailAddress) },
  events: [EmailAddressSet],
  rejects: [Forbidden, NotInboxOwner],
}) {}
