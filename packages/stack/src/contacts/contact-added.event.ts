import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ContactType, Purposes } from "./contact-book.id.ts";
import { ContactDetails } from "./contact.ts";

export class ContactAdded extends Domain.Event("ContactAdded", {
  contactId: Schema.String,
  type: ContactType,
  value: Schema.NullOr(Schema.String),
  details: ContactDetails,
  purposes: Purposes,
  by: Schema.String,
}) {}
