import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import {
  type Attribution,
  attributionOf,
  Forbidden,
  requirePermission,
  Session,
} from "@house-rules/stack";
import { AddContact } from "./add-contact.command.ts";
import { ContactAdded } from "./contact-added.event.ts";
import { ContactBookId, type ContactType } from "./contact-book.id.ts";
import { ContactNotFound } from "./contact-not-found.rejection.ts";
import { ContactVerified } from "./contact-verified.event.ts";
import {
  type ContactBookState,
  ContactBookState as State,
  claimsFor,
  findByValue,
  manages,
  normalize,
} from "./contact.ts";
import { DuplicateContact } from "./duplicate-contact.rejection.ts";
import { ImportVerifiedContact } from "./import-verified-contact.command.ts";
import { InvalidContact } from "./invalid-contact.rejection.ts";
import { NotContactOwner } from "./not-contact-owner.rejection.ts";
import { ContactsPermissions } from "./permissions.ts";
import { PrimaryContactChanged } from "./primary-contact-changed.event.ts";
import { ContactRemoved, RemoveContact } from "./remove-contact.command.ts";
import { RequestVerification, VerificationRequested } from "./request-verification.command.ts";
import { SetPrimaryContact } from "./set-primary-contact.command.ts";
import { VerifyContact } from "./verify-contact.command.ts";

const asOwner = Effect.fn(function* (book: string) {
  const actor = yield* requirePermission(ContactsPermissions.write);
  if (!manages(actor, book)) return yield* new NotContactOwner();
  return actor;
});

const contactIn = (s: ContactBookState, contactId: string) =>
  Object.hasOwn(s.contacts, contactId) ? s.contacts[contactId] : undefined;

const primaryChange = (
  s: ContactBookState,
  contactId: string,
  type: ContactType,
  purposes: ReadonlyArray<string>,
  attribution: Attribution,
) => {
  const previous = claimsFor(s, contactId, type, purposes);
  return Object.keys(previous).length === 0
    ? []
    : [new PrimaryContactChanged({ contactId, previous, ...attribution })];
};

export class ContactBook extends Domain.Aggregate("ContactBook", {
  id: ContactBookId,
  state: State,
  initial: { contacts: {} },
  commands: [
    AddContact,
    RemoveContact,
    SetPrimaryContact,
    RequestVerification,
    VerifyContact,
    ImportVerifiedContact,
  ],
  decide: {
    AddContact: Effect.fn(function* (s, cmd, { id }) {
      const attribution = attributionOf(yield* asOwner(id));
      if (contactIn(s, cmd.contactId))
        return yield* new DuplicateContact({ contactId: cmd.contactId });
      if (cmd.type === "postal" && cmd.value !== undefined)
        return yield* new InvalidContact({ reason: "value-not-allowed" });
      const value = cmd.type === "postal" ? null : normalize(cmd.type, cmd.value ?? "");
      if (value === "") return yield* new InvalidContact({ reason: "value-required" });
      const taken = value === null ? undefined : findByValue(s, cmd.type, value);
      if (taken) return yield* new DuplicateContact({ contactId: taken[0] });
      const purposes = [...new Set(cmd.purposes)];
      const added = new ContactAdded({
        contactId: cmd.contactId,
        type: cmd.type,
        value,
        details: cmd.details ?? {},
        purposes,
        ...attribution,
      });
      if (!cmd.primary) return [added];
      return [added, ...primaryChange(s, cmd.contactId, cmd.type, purposes, attribution)];
    }),
    RemoveContact: Effect.fn(function* (s, cmd, { id }) {
      const attribution = attributionOf(yield* asOwner(id));
      if (!contactIn(s, cmd.contactId))
        return yield* new ContactNotFound({ contactId: cmd.contactId });
      return [new ContactRemoved({ contactId: cmd.contactId, ...attribution })];
    }),
    SetPrimaryContact: Effect.fn(function* (s, cmd, { id }) {
      const attribution = attributionOf(yield* asOwner(id));
      const contact = contactIn(s, cmd.contactId);
      if (!contact) return yield* new ContactNotFound({ contactId: cmd.contactId });
      const purposes = cmd.purposes ?? contact.purposes;
      if (purposes.some((purpose) => !contact.purposes.includes(purpose)))
        return yield* new InvalidContact({ reason: "purpose-not-offered" });
      return primaryChange(s, cmd.contactId, contact.type, purposes, attribution);
    }),
    RequestVerification: Effect.fn(function* (s, cmd, { id }) {
      const attribution = attributionOf(yield* asOwner(id));
      const contact = contactIn(s, cmd.contactId);
      if (!contact) return yield* new ContactNotFound({ contactId: cmd.contactId });
      if (contact.type === "postal" || contact.value === null)
        return yield* new InvalidContact({ reason: "not-verifiable" });
      if (contact.verifiedAt !== null) return [];
      return [
        new VerificationRequested({
          contactId: cmd.contactId,
          type: contact.type,
          address: contact.value,
          ...attribution,
        }),
      ];
    }),
    VerifyContact: Effect.fn(function* (s, cmd) {
      const attribution = attributionOf(yield* requirePermission(ContactsPermissions.verify));
      const contact = contactIn(s, cmd.contactId);
      if (contact?.value !== cmd.address)
        return yield* new ContactNotFound({ contactId: cmd.contactId });
      if (contact.verifiedAt !== null) return [];
      return [new ContactVerified({ contactId: cmd.contactId, ...attribution })];
    }),
    ImportVerifiedContact: Effect.fn(function* (s, cmd) {
      const attribution = attributionOf(yield* requirePermission(ContactsPermissions.import));
      const email = normalize("email", cmd.email);
      const existing = findByValue(s, "email", email);
      if (existing) {
        const [contactId, contact] = existing;
        const verified =
          contact.verifiedAt === null ? [new ContactVerified({ contactId, ...attribution })] : [];
        if (!cmd.primary) return verified;
        return [
          ...verified,
          ...primaryChange(s, contactId, "email", contact.purposes, attribution),
        ];
      }
      if (contactIn(s, cmd.contactId))
        return yield* new DuplicateContact({ contactId: cmd.contactId });
      const purposes = [...new Set(cmd.purposes)];
      const { contactId } = cmd;
      const facts = [
        new ContactAdded({
          contactId,
          type: "email",
          value: email,
          details: {},
          purposes,
          ...attribution,
        }),
        new ContactVerified({ contactId, ...attribution }),
      ];
      if (!cmd.primary) return facts;
      return [...facts, ...primaryChange(s, contactId, "email", purposes, attribution)];
    }),
  },
  evolve: {
    ContactAdded: (s, e, { at }) => ({
      contacts: {
        ...s.contacts,
        [e.contactId]: {
          type: e.type,
          value: e.value,
          details: e.details,
          purposes: e.purposes,
          primaryFor: [],
          verifiedAt: null,
          addedAt: at,
        },
      },
    }),
    ContactRemoved: (s, e) => ({
      contacts: Object.fromEntries(Object.entries(s.contacts).filter(([id]) => id !== e.contactId)),
    }),
    PrimaryContactChanged: (s, e) => {
      const moved = Object.keys(e.previous);
      return {
        contacts: Object.fromEntries(
          Object.entries(s.contacts).map(([id, c]) => [
            id,
            {
              ...c,
              primaryFor:
                id === e.contactId
                  ? [...new Set([...c.primaryFor, ...moved])]
                  : c.primaryFor.filter((purpose) => e.previous[purpose] !== id),
            },
          ]),
        ),
      };
    },
    VerificationRequested: (s) => s,
    ContactVerified: (s, e, { at }) => {
      const contact = contactIn(s, e.contactId);
      if (!contact) return s;
      return { contacts: { ...s.contacts, [e.contactId]: { ...contact, verifiedAt: at } } };
    },
  },
  read: {
    middleware: [Session],
    rejects: [Forbidden, NotContactOwner],
    validate: Effect.fn(function* (request) {
      const actor = yield* requirePermission(ContactsPermissions.read);
      if (actor._tag !== "System" && !manages(actor, request.key.id))
        return yield* new NotContactOwner();
    }),
  },
}) {}
