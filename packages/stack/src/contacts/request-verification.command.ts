import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { Session } from "../auth/session.middleware.ts";
import { ContactBookId, ContactId } from "./contact-book.id.ts";
import { ContactNotFound } from "./contact-not-found.rejection.ts";
import { InvalidContact } from "./invalid-contact.rejection.ts";
import { NotContactOwner } from "./not-contact-owner.rejection.ts";

export class VerificationRequested extends Domain.Event("VerificationRequested", {
  contactId: Schema.String,
  type: Schema.Literals(["email", "phone"]),
  address: Schema.String,
  by: Schema.String,
}) {}

export class RequestVerification extends Domain.Command("RequestVerification", {
  target: ContactBookId,
  middleware: [Session],
  input: { contactId: ContactId },
  events: [VerificationRequested],
  rejects: [Forbidden, NotContactOwner, ContactNotFound, InvalidContact],
}) {}
