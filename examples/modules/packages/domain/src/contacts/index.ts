import { ContactBook } from "./contact-book.aggregate.ts";
import { VerificationDelivery, VerificationDeliveryLive } from "./verification-delivery.policy.ts";

export { AddContact } from "./add-contact.command.ts";
export { ContactAdded } from "./contact-added.event.ts";
export { ContactBook } from "./contact-book.aggregate.ts";
export { ContactBookId, ContactId, ContactType, Purposes } from "./contact-book.id.ts";
export { ContactNotFound } from "./contact-not-found.rejection.ts";
export { ContactVerified } from "./contact-verified.event.ts";
export {
  Contact,
  ContactBookState,
  ContactDetails,
  primaryOf,
} from "./contact.ts";
export { DuplicateContact } from "./duplicate-contact.rejection.ts";
export { ImportVerifiedContact } from "./import-verified-contact.command.ts";
export { InvalidContact } from "./invalid-contact.rejection.ts";
export { memoryVerificationCodes, type SentCode } from "./memory-verification-codes.ts";
export { NotContactOwner } from "./not-contact-owner.rejection.ts";
export { ContactsPermissions } from "./permissions.ts";
export { PrimaryContactChanged } from "./primary-contact-changed.event.ts";
export { ContactRemoved, RemoveContact } from "./remove-contact.command.ts";
export { RequestVerification, VerificationRequested } from "./request-verification.command.ts";
export { SetPrimaryContact } from "./set-primary-contact.command.ts";
export {
  CodeInvalid,
  VerificationCodes,
  VerificationNotSent,
} from "./verification-codes.external.ts";
export { VerificationDelivery, VerificationDeliveryLive } from "./verification-delivery.policy.ts";
export { VerifyContact } from "./verify-contact.command.ts";

export const aggregates = [ContactBook] as const;
export const policies = [VerificationDelivery] as const;
export const handlers = VerificationDeliveryLive;
