import { Schema } from "effect";
import { ContactOwner, ContactType } from "./contact.js";

const subject = { contactId: Schema.NonEmptyString };
export const ContactAdded = Schema.Struct({
  kind: Schema.Literal("ContactAdded"),
  ...subject,
  owner: ContactOwner,
  type: ContactType,
});
export const ContactRemoved = Schema.Struct({
  kind: Schema.Literal("ContactRemoved"),
  ...subject,
  owner: ContactOwner,
});
export const PrimaryChanged = Schema.Struct({
  kind: Schema.Literal("PrimaryChanged"),
  ...subject,
  owner: ContactOwner,
  previousContactIds: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
});
export const VerificationRequested = Schema.Struct({
  kind: Schema.Literal("VerificationRequested"),
  ...subject,
});
export const ContactVerified = Schema.Struct({
  kind: Schema.Literal("ContactVerified"),
  ...subject,
});
export const ContactEvent = Schema.Union([
  ContactAdded,
  ContactRemoved,
  PrimaryChanged,
  VerificationRequested,
  ContactVerified,
]);
export type ContactEvent = typeof ContactEvent.Type;
export const ContactEvents = {
  ContactAdded,
  ContactRemoved,
  PrimaryChanged,
  VerificationRequested,
  ContactVerified,
} as const;
