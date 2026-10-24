import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const ContactOwner = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type ContactOwner = typeof ContactOwner.Type;
export const ContactType = Schema.Literals(["email", "phone", "postal"]);
export type ContactType = typeof ContactType.Type;
export const ContactDetails = Schema.StructWithRest(
  Schema.Struct({
    lines: Schema.optionalKey(Schema.Array(Schema.String)),
    locality: Schema.optionalKey(Schema.String),
    region: Schema.optionalKey(Schema.String),
    postalCode: Schema.optionalKey(Schema.String),
    country: Schema.optionalKey(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
export type ContactDetails = typeof ContactDetails.Type;
export const Contact = Schema.Struct({
  id: Schema.NonEmptyString,
  owner: ContactOwner,
  type: ContactType,
  valueNormalized: Schema.NullOr(Schema.NonEmptyString),
  details: ContactDetails,
  purposes: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  primaryPurposes: Schema.Array(Schema.NonEmptyString),
  verifiedAt: Schema.NullOr(Schema.Int),
  createdAt: Schema.Int,
}).check(
  Schema.makeFilter(
    (contact) =>
      new Set(contact.primaryPurposes).size === contact.primaryPurposes.length &&
      contact.primaryPurposes.every((purpose) => contact.purposes.includes(purpose)),
  ),
);
export type Contact = typeof Contact.Type;
export const AddContact = Schema.Struct({
  owner: ContactOwner,
  type: ContactType,
  value: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(ContactDetails),
  purposes: Contact.fields.purposes,
  primary: Schema.optionalKey(Schema.Boolean),
});
export type AddContact = typeof AddContact.Type;
export const ImportVerified = Schema.Struct({
  owner: ContactOwner,
  type: Schema.Literal("email"),
  value: Schema.NonEmptyString,
  purposes: Contact.fields.purposes,
  verifiedAt: Schema.Int,
  primary: Schema.optionalKey(Schema.Boolean),
});
export type ImportVerified = typeof ImportVerified.Type;
export const ContactCursor = Schema.Struct({ createdAt: Schema.Int, id: Schema.NonEmptyString });
export type ContactCursor = typeof ContactCursor.Type;
export const ContactPage = Schema.Struct({
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optionalKey(ContactCursor),
});
export type ContactPage = typeof ContactPage.Type;
export const ContactList = Schema.Struct({
  contacts: Schema.Array(Contact),
  next: Schema.optionalKey(ContactCursor),
});
export type ContactList = typeof ContactList.Type;
export class ContactNotFound extends Schema.TaggedError<ContactNotFound>()("ContactNotFound", {
  kind: errorKind("not_found"),
}) {}
export class ContactInputInvalid extends Schema.TaggedError<ContactInputInvalid>()(
  "ContactInputInvalid",
  {
    kind: errorKind("invalid"),
    message: Schema.String,
  },
) {}
export class ContactConflict extends Schema.TaggedError<ContactConflict>()("ContactConflict", {
  kind: errorKind("conflict"),
}) {}
export class VerificationInvalid extends Schema.TaggedError<VerificationInvalid>()(
  "VerificationInvalid",
  {
    kind: errorKind("invalid"),
  },
) {}
export class ContactStoreUnavailable extends Schema.TaggedError<ContactStoreUnavailable>()(
  "ContactStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Contacts are unavailable. Try again shortly.";
  }
}
export class ContactOwnersUnavailable extends Schema.TaggedError<ContactOwnersUnavailable>()(
  "ContactOwnersUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Contact owners are unavailable. Try again shortly.";
  }
}
export type ContactFailure =
  | ContactNotFound
  | ContactInputInvalid
  | ContactConflict
  | VerificationInvalid
  | ContactStoreUnavailable
  | ContactOwnersUnavailable;
