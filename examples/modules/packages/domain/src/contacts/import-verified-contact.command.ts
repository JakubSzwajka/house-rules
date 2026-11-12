import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { ContactAdded } from "./contact-added.event.ts";
import { ContactBookId, ContactId, Purposes } from "./contact-book.id.ts";
import { ContactVerified } from "./contact-verified.event.ts";
import { DuplicateContact } from "./duplicate-contact.rejection.ts";
import { PrimaryContactChanged } from "./primary-contact-changed.event.ts";

export class ImportVerifiedContact extends Domain.Command("ImportVerifiedContact", {
  target: ContactBookId,
  middleware: [Session],
  input: {
    contactId: ContactId,
    email: Schema.NonEmptyString.check(Schema.isTrimmed()),
    purposes: Purposes,
    primary: Schema.optionalKey(Schema.Boolean),
  },
  events: [ContactAdded, ContactVerified, PrimaryContactChanged],
  rejects: [Forbidden, DuplicateContact],
}) {}
