import * as Schema from "effect/Schema";
import { type Actor, can } from "@house-rules/stack";
import { ContactType } from "./contact-book.id.ts";
import { ContactsPermissions } from "./permissions.ts";

export const ContactDetails = Schema.Struct({
  lines: Schema.optionalKey(Schema.Array(Schema.String)),
  locality: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(Schema.String),
  postalCode: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String),
});

export const Contact = Schema.Struct({
  type: ContactType,
  value: Schema.NullOr(Schema.String),
  details: ContactDetails,
  purposes: Schema.Array(Schema.String),
  primaryFor: Schema.Array(Schema.String),
  verifiedAt: Schema.NullOr(Schema.DateTimeUtc),
  addedAt: Schema.DateTimeUtc,
});
export type Contact = typeof Contact.Type;

export const ContactBookState = Schema.Struct({
  contacts: Schema.Record(Schema.String, Contact),
});
export type ContactBookState = typeof ContactBookState.Type;

export const normalize = (type: ContactType, value: string): string =>
  type === "email" ? value.trim().toLowerCase() : value.replace(/\s/g, "");

export const findByValue = (book: ContactBookState, type: ContactType, value: string) =>
  Object.entries(book.contacts).find(([, c]) => c.type === type && c.value === value);

export const manages = (actor: Actor, owner: string): boolean =>
  actor._tag === "Person" &&
  (actor.id === owner || (actor.orgId === owner && can(actor, ContactsPermissions.manageOrg)));

export const claimsFor = (
  book: ContactBookState,
  contactId: string,
  type: ContactType,
  purposes: ReadonlyArray<string>,
): Record<string, string | null> => {
  const holders = Object.entries(book.contacts).filter(([, c]) => c.type === type);
  const moved: Record<string, string | null> = {};
  for (const purpose of new Set(purposes)) {
    const holder = holders.find(([, c]) => c.primaryFor.includes(purpose))?.[0] ?? null;
    if (holder !== contactId) moved[purpose] = holder;
  }
  return moved;
};

export const primaryOf = (
  book: ContactBookState,
  type: ContactType,
  purpose: string,
  options: { readonly verifiedOnly?: boolean } = {},
) =>
  Object.entries(book.contacts)
    .map(([id, contact]) => ({ id, ...contact }))
    .find(
      (c) =>
        c.type === type &&
        c.primaryFor.includes(purpose) &&
        (!options.verifiedOnly || c.verifiedAt !== null),
    );
