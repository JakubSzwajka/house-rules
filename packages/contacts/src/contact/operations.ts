import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  AddContact,
  Contact,
  ContactConflict,
  ContactInputInvalid,
  ContactList,
  ContactNotFound,
  ContactOwner,
  ContactOwnersUnavailable,
  ContactPage,
  ContactStoreUnavailable,
  ContactType,
  ImportVerified,
  VerificationInvalid,
} from "./contact.js";
import { ContactEvent } from "./events.js";

export const ContactPermissions = {
  read: "contacts:read",
  write: "contacts:write",
  verify: "contacts:verify",
  import: "contacts:import",
} as const;
const failure = Schema.Union([
  ContactConflict,
  ContactInputInvalid,
  ContactNotFound,
  ContactOwnersUnavailable,
  ContactStoreUnavailable,
  VerificationInvalid,
]);
const events = Schema.Array(ContactEvent);
const contactResult = Schema.Struct({ contact: Contact, events });
const idInput = Schema.Struct({ contactId: Schema.NonEmptyString });
const idResult = Schema.Struct({ contactId: Schema.NonEmptyString, events });
const addContact = defineOperation("Contacts.addContact", {
  description: "Add a contact point to a party.",
  input: AddContact,
  output: contactResult,
  failure,
  permission: ContactPermissions.write,
  transactional: true,
});
const importVerified = defineOperation("Contacts.importVerified", {
  description: "System only: import an identity-verified email, safely retrying first sign-in.",
  input: ImportVerified,
  output: contactResult,
  failure,
  permission: ContactPermissions.import,
  transactional: true,
});
const removeContact = defineOperation("Contacts.removeContact", {
  description: "Remove a contact point and its verification tokens.",
  input: idInput,
  output: idResult,
  failure,
  permission: ContactPermissions.write,
  transactional: true,
  destructive: true,
});
const setPrimary = defineOperation("Contacts.setPrimary", {
  description: "Make a contact primary for selected purposes, defaulting to all its purposes.",
  input: Schema.Struct({
    ...idInput.fields,
    purposes: Schema.optionalKey(Contact.fields.purposes),
  }),
  output: contactResult,
  failure,
  permission: ContactPermissions.write,
  transactional: true,
});
const listFor = defineOperation("Contacts.listFor", {
  description: "List a party's contact points, oldest first.",
  input: Schema.Struct({ owner: ContactOwner, page: Schema.optionalKey(ContactPage) }),
  output: ContactList,
  failure,
  permission: ContactPermissions.read,
  readOnly: true,
});
const requestVerification = defineOperation("Contacts.requestVerification", {
  description: "Return a verification request fact without a secret token.",
  input: idInput,
  output: idResult,
  failure,
  permission: ContactPermissions.write,
  transactional: true,
});
const issueVerificationToken = defineOperation("Contacts.issueVerificationToken", {
  description: "System only: issue a one-time email verification token, replacing earlier tokens.",
  input: idInput,
  output: Schema.Struct({
    contact: Contact,
    token: Schema.NonEmptyString,
    expiresAt: Schema.Int,
    events,
  }),
  failure,
  permission: ContactPermissions.verify,
  transactional: true,
});
const verify = defineOperation("Contacts.verify", {
  description:
    "Consume an email verification token, including for an unsigned-in system-start feature.",
  input: Schema.Struct({ token: Schema.NonEmptyString }),
  output: contactResult,
  failure,
  permission: ContactPermissions.verify,
  transactional: true,
});
const primaryFor = defineOperation("Contacts.primaryFor", {
  description:
    "Find a primary contact, optionally verified only. System callers may use it for delivery.",
  input: Schema.Struct({
    owner: ContactOwner,
    type: ContactType,
    purpose: Schema.NonEmptyString,
    verifiedOnly: Schema.Boolean,
  }),
  output: Schema.NullOr(Contact),
  failure,
  permission: ContactPermissions.read,
  readOnly: true,
});
export const ContactsOperations = {
  addContact,
  importVerified,
  removeContact,
  setPrimary,
  listFor,
  requestVerification,
  issueVerificationToken,
  verify,
  primaryFor,
} as const;
