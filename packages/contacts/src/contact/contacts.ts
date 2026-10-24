import { type Actor, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Schema } from "effect";
import { Hex } from "effect/encoding";
import type { ContactStore } from "../storage.js";
import type { ContactOwners } from "./contact-owners.js";
import {
  AddContact,
  Contact,
  ContactInputInvalid,
  ContactNotFound,
  ContactOwner,
  ContactPage,
  ContactStoreUnavailable,
  ContactType,
  ImportVerified,
  VerificationInvalid,
} from "./contact.js";
import type { ContactEvent } from "./events.js";
import type { ContactsOptions } from "./options.js";

const invalid = () => new ContactInputInvalid({ message: "Invalid contact input." });
const randomToken = Effect.sync(() =>
  Hex.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))),
);
const hashToken = (token: string) =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    catch: (cause) => new ContactStoreUnavailable({ cause }),
  }).pipe(Effect.map((bytes) => Hex.encode(new Uint8Array(bytes))));
const eventResult = (contact: Contact, events: ReadonlyArray<ContactEvent>) => ({
  contact,
  events,
});

export const makeContacts = (
  store: ContactStore["Service"],
  owners: ContactOwners["Service"],
  options: ContactsOptions,
) => {
  const access = Effect.fn("Contacts.access")(function* (
    actor: Actor,
    owner: ContactOwner,
    write: boolean,
  ) {
    yield* Schema.decodeEffect(ContactOwner)(owner).pipe(Effect.mapError(invalid));
    const allowed = yield* owners.access(actor, owner);
    if (allowed === "none" || (write && allowed !== "write")) return yield* new ContactNotFound();
  });
  const owned = Effect.fn("Contacts.owned")(function* (actor: Actor, id: string, write: boolean) {
    const contact = yield* store.get(id);
    if (!contact) return yield* new ContactNotFound();
    yield* access(actor, contact.owner, write);
    return contact;
  });
  const checkTypePurpose = Effect.fn("Contacts.checkTypePurpose")(function* (
    type: ContactType,
    purpose: string,
  ) {
    if (!options.allowedTypes.includes(type) || !options.purposes.includes(purpose))
      return yield* invalid();
  });
  return {
    addContact: Effect.fn("Contacts.addContact")(function* (actor: Actor, input: AddContact) {
      yield* UnitOfWork.required;
      const decoded = yield* Schema.decodeEffect(AddContact)(input).pipe(Effect.mapError(invalid));
      yield* access(actor, decoded.owner, true);
      for (const purpose of decoded.purposes) yield* checkTypePurpose(decoded.type, purpose);
      if (new Set(decoded.purposes).size !== decoded.purposes.length) return yield* invalid();
      const valueNormalized =
        decoded.type === "postal"
          ? null
          : decoded.type === "email"
            ? decoded.value?.trim().toLowerCase()
            : decoded.value?.trim().replace(/\s/g, "");
      if (decoded.type !== "postal" && !valueNormalized) return yield* invalid();
      if (decoded.type === "postal" && decoded.value !== undefined) return yield* invalid();
      const contact: Contact = {
        id: yield* randomToken,
        owner: { ...decoded.owner },
        type: decoded.type,
        valueNormalized: valueNormalized ?? null,
        details: decoded.details ?? {},
        purposes: [...decoded.purposes],
        primaryPurposes: [],
        verifiedAt: null,
        createdAt: yield* Clock.currentTimeMillis,
      };
      yield* store.insert(contact);
      const events: ContactEvent[] = [
        { kind: "ContactAdded", contactId: contact.id, owner: contact.owner, type: contact.type },
      ];
      if (!decoded.primary) return eventResult(contact, events);
      const selection = yield* store.setPrimary(contact.id);
      if (!selection) return yield* new ContactNotFound();
      events.push({
        kind: "PrimaryChanged",
        contactId: contact.id,
        owner: contact.owner,
        previousContactIds: selection.previousContactIds,
      });
      return eventResult(selection.contact, events);
    }),
    importVerified: Effect.fn("Contacts.importVerified")(function* (input: ImportVerified) {
      yield* UnitOfWork.required;
      const decoded = yield* Schema.decodeEffect(ImportVerified)(input).pipe(
        Effect.mapError(invalid),
      );
      for (const purpose of decoded.purposes) yield* checkTypePurpose(decoded.type, purpose);
      if (new Set(decoded.purposes).size !== decoded.purposes.length) return yield* invalid();
      const valueNormalized = decoded.value.trim().toLowerCase();
      if (!valueNormalized) return yield* invalid();
      const result = yield* store.importVerified({
        id: yield* randomToken,
        owner: { ...decoded.owner },
        type: decoded.type,
        valueNormalized,
        details: {},
        purposes: [...decoded.purposes],
        primaryPurposes: [],
        verifiedAt: decoded.verifiedAt,
        createdAt: yield* Clock.currentTimeMillis,
      });
      const events: ContactEvent[] = [];
      if (result.added)
        events.push({
          kind: "ContactAdded",
          contactId: result.contact.id,
          owner: result.contact.owner,
          type: "email",
        });
      if (result.verified) events.push({ kind: "ContactVerified", contactId: result.contact.id });
      if (!decoded.primary) return eventResult(result.contact, events);
      const selection = yield* store.setPrimary(result.contact.id);
      if (!selection) return yield* new ContactNotFound();
      if (Object.keys(selection.previousContactIds).length > 0)
        events.push({
          kind: "PrimaryChanged",
          contactId: selection.contact.id,
          owner: selection.contact.owner,
          previousContactIds: selection.previousContactIds,
        });
      return eventResult(selection.contact, events);
    }),
    removeContact: Effect.fn("Contacts.removeContact")(function* (actor: Actor, contactId: string) {
      yield* UnitOfWork.required;
      const contact = yield* owned(actor, contactId, true);
      if (!(yield* store.remove(contactId))) return yield* new ContactNotFound();
      return {
        contactId,
        events: [{ kind: "ContactRemoved" as const, contactId, owner: contact.owner }],
      };
    }),
    setPrimary: Effect.fn("Contacts.setPrimary")(function* (
      actor: Actor,
      contactId: string,
      purposes?: ReadonlyArray<string>,
    ) {
      yield* UnitOfWork.required;
      const contact = yield* owned(actor, contactId, true);
      const selected = yield* Schema.decodeEffect(Contact.fields.purposes)(
        purposes ?? contact.purposes,
      ).pipe(Effect.mapError(invalid));
      if (
        new Set(selected).size !== selected.length ||
        selected.some((purpose) => !contact.purposes.includes(purpose))
      )
        return yield* invalid();
      const selection = yield* store.setPrimary(contactId, selected);
      if (!selection) return yield* new ContactNotFound();
      return eventResult(selection.contact, [
        {
          kind: "PrimaryChanged",
          contactId,
          owner: selection.contact.owner,
          previousContactIds: selection.previousContactIds,
        },
      ]);
    }),
    listFor: Effect.fn("Contacts.listFor")(function* (
      actor: Actor,
      owner: ContactOwner,
      page?: ContactPage,
    ) {
      yield* access(actor, owner, false);
      const decoded = yield* Schema.decodeEffect(ContactPage)(page ?? {}).pipe(
        Effect.mapError(invalid),
      );
      const size = Math.min(decoded.size ?? options.maxPageSize, options.maxPageSize);
      const rows = yield* store.list(owner, {
        size: size + 1,
        ...(decoded.cursor === undefined ? {} : { after: decoded.cursor }),
      });
      const contacts = rows.slice(0, size);
      const last = contacts[contacts.length - 1];
      return rows.length > size && last !== undefined
        ? { contacts, next: { createdAt: last.createdAt, id: last.id } }
        : { contacts };
    }),
    requestVerification: Effect.fn("Contacts.requestVerification")(function* (
      actor: Actor,
      contactId: string,
    ) {
      yield* UnitOfWork.required;
      const contact = yield* owned(actor, contactId, true);
      if (contact.type !== "email") return yield* invalid();
      return { contactId, events: [{ kind: "VerificationRequested" as const, contactId }] };
    }),
    issueVerificationToken: Effect.fn("Contacts.issueVerificationToken")(function* (
      contactId: string,
    ) {
      yield* UnitOfWork.required;
      const contact = yield* store.get(contactId);
      if (!contact) return yield* new ContactNotFound();
      if (contact.type !== "email") return yield* invalid();
      const token = yield* randomToken;
      const expiresAt = (yield* Clock.currentTimeMillis) + options.verificationTokenTtlMs;
      if (!(yield* store.replaceToken(contactId, yield* hashToken(token), expiresAt)))
        return yield* new ContactNotFound();
      return { contact, token, expiresAt, events: [] as ReadonlyArray<ContactEvent> };
    }),
    verify: Effect.fn("Contacts.verify")(function* (token: string) {
      yield* UnitOfWork.required;
      const contact = yield* store.consumeToken(
        yield* hashToken(token),
        yield* Clock.currentTimeMillis,
      );
      if (!contact) return yield* new VerificationInvalid();
      return eventResult(contact, [{ kind: "ContactVerified", contactId: contact.id }]);
    }),
    primaryFor: Effect.fn("Contacts.primaryFor")(function* (
      actor: Actor | null,
      owner: ContactOwner,
      type: ContactType,
      purpose: string,
      verifiedOnly: boolean,
    ) {
      yield* Schema.decodeEffect(ContactOwner)(owner).pipe(Effect.mapError(invalid));
      if (actor !== null) yield* access(actor, owner, false);
      yield* checkTypePurpose(type, purpose);
      return (yield* store.primaryFor(owner, type, purpose, verifiedOnly)) ?? null;
    }),
    erase: Effect.fn("Contacts.erase")(function* (owner: ContactOwner) {
      yield* UnitOfWork.required;
      yield* Schema.decodeEffect(ContactOwner)(owner).pipe(Effect.mapError(invalid));
      yield* store.erase(owner);
    }),
  };
};
export type ContactsService = ReturnType<typeof makeContacts>;
