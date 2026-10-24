import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import { ContactNotFound } from "./contact.js";
import type { ContactsService } from "./contacts.js";
import { ContactsOperations } from "./operations.js";
export const bindContacts = (service: ContactsService): readonly Binding[] => [
  bindOperation(ContactsOperations.addContact, (input, { caller }) =>
    caller.kind === "person"
      ? service.addContact(caller.actor, input)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.importVerified, (input, { caller }) =>
    caller.kind === "system" ? service.importVerified(input) : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.removeContact, ({ contactId }, { caller }) =>
    caller.kind === "person"
      ? service.removeContact(caller.actor, contactId)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.setPrimary, ({ contactId, purposes }, { caller }) =>
    caller.kind === "person"
      ? service.setPrimary(caller.actor, contactId, purposes)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.listFor, ({ owner, page }, { caller }) =>
    caller.kind === "person"
      ? service.listFor(caller.actor, owner, page)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.requestVerification, ({ contactId }, { caller }) =>
    caller.kind === "person"
      ? service.requestVerification(caller.actor, contactId)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.issueVerificationToken, ({ contactId }, { caller }) =>
    caller.kind === "system"
      ? service.issueVerificationToken(contactId)
      : Effect.fail(new ContactNotFound()),
  ),
  bindOperation(ContactsOperations.verify, ({ token }) => service.verify(token)),
  bindOperation(
    ContactsOperations.primaryFor,
    ({ owner, type, purpose, verifiedOnly }, { caller }) =>
      service.primaryFor(
        caller.kind === "person" ? caller.actor : null,
        owner,
        type,
        purpose,
        verifiedOnly,
      ),
  ),
];
