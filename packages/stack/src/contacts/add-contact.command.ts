import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ContactAdded } from "./contact-added.event.ts";
import { ContactBookId, ContactId, ContactType, Purposes } from "./contact-book.id.ts";
import { ContactDetails } from "./contact.ts";
import { DuplicateContact } from "./duplicate-contact.rejection.ts";
import { InvalidContact } from "./invalid-contact.rejection.ts";
import { NotContactOwner } from "./not-contact-owner.rejection.ts";
import { PrimaryContactChanged } from "./primary-contact-changed.event.ts";

export class AddContact extends Domain.Command("AddContact", {
  target: ContactBookId,
  middleware: [Session],
  input: {
    contactId: ContactId,
    type: ContactType,
    value: Schema.optionalKey(Schema.String),
    details: Schema.optionalKey(ContactDetails),
    purposes: Purposes,
    primary: Schema.optionalKey(Schema.Boolean),
  },
  events: [ContactAdded, PrimaryContactChanged],
  rejects: [Forbidden, NotContactOwner, DuplicateContact, InvalidContact],
}) {}
