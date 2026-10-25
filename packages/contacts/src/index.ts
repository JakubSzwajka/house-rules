import type { MountDefinition } from "@house-rules/application";
import { bindContacts } from "./contact/bind-contacts.js";
import { ContactsOperations } from "./contact/operations.js";
import { Contacts } from "./facade.js";
export const ContactsMount = {
  map: { name: "contacts", kind: "package", package: "@house-rules/contacts" },
  service: Contacts,
  operations: Object.values(ContactsOperations),
  bind: bindContacts,
} satisfies MountDefinition<Contacts, Contacts["Service"]>;
export { Contacts } from "./facade.js";
export { bindContacts } from "./contact/bind-contacts.js";
export { ContactOwners, type ContactAccess } from "./contact/contact-owners.js";
export { ContactsOptions } from "./contact/options.js";
export { ContactStore, type PrimarySelection } from "./storage.js";
export { memoryContactStore } from "./adapters/memory/contact.js";
export { postgresContactStore } from "./adapters/postgres/contact.js";
export {
  AddContact,
  Contact,
  ContactConflict,
  ContactCursor,
  ContactDetails,
  type ContactFailure,
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
  ContactAdded,
  ContactEvent,
  ContactEvents,
  ContactRemoved,
  ContactVerified,
  PrimaryChanged,
  VerificationRequested,
  ContactPermissions,
  ContactsOperations,
} from "./contract.js";
