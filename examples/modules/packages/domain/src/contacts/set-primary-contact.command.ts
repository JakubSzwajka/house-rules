import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { ContactBookId, ContactId, Purposes } from "./contact-book.id.ts";
import { ContactNotFound } from "./contact-not-found.rejection.ts";
import { InvalidContact } from "./invalid-contact.rejection.ts";
import { NotContactOwner } from "./not-contact-owner.rejection.ts";
import { PrimaryContactChanged } from "./primary-contact-changed.event.ts";

export class SetPrimaryContact extends Domain.Command("SetPrimaryContact", {
  target: ContactBookId,
  middleware: [Session],
  input: { contactId: ContactId, purposes: Schema.optionalKey(Purposes) },
  events: [PrimaryContactChanged],
  rejects: [Forbidden, NotContactOwner, ContactNotFound, InvalidContact],
}) {}
