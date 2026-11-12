import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session } from "@house-rules/stack";
import { ContactBookId, ContactId } from "./contact-book.id.ts";
import { ContactNotFound } from "./contact-not-found.rejection.ts";
import { NotContactOwner } from "./not-contact-owner.rejection.ts";

export class ContactRemoved extends Domain.Event("ContactRemoved", {
  contactId: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}

export class RemoveContact extends Domain.Command("RemoveContact", {
  target: ContactBookId,
  middleware: [Session],
  input: { contactId: ContactId },
  events: [ContactRemoved],
  rejects: [Forbidden, NotContactOwner, ContactNotFound],
}) {}
