import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden, Session } from "@house-rules/stack";
import { ContactBookId, ContactId } from "./contact-book.id.ts";
import { ContactNotFound } from "./contact-not-found.rejection.ts";
import { ContactVerified } from "./contact-verified.event.ts";

export class VerifyContact extends Domain.Command("VerifyContact", {
  target: ContactBookId,
  middleware: [Session],
  input: { contactId: ContactId, address: Schema.String },
  events: [ContactVerified],
  rejects: [Forbidden, ContactNotFound],
}) {}
