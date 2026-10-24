import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { type Contact, ContactConflict, type ContactOwner } from "../../contact/contact.js";
import { ContactStore } from "../../storage.js";
const copy = (contact: Contact): Contact => structuredClone(contact);
const sameOwner = (contact: Contact, owner: ContactOwner) =>
  contact.owner.kind === owner.kind && contact.owner.id === owner.id;
export const memoryContactStore = (): Layer.Layer<ContactStore> =>
  Layer.sync(ContactStore, () => {
    const rows = new Map<string, Contact>();
    const tokens = new Map<string, { readonly hash: string; readonly expiresAt: number }>();
    const change = Effect.fn("ContactStore.memory.change")(function* <A>(run: () => A) {
      yield* UnitOfWork.required;
      const before = new Map([...rows].map(([id, contact]) => [id, copy(contact)]));
      const beforeTokens = new Map(tokens);
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          tokens.clear();
          for (const [id, contact] of before) rows.set(id, contact);
          for (const [id, token] of beforeTokens) tokens.set(id, token);
        }),
      );
      return yield* Effect.sync(run);
    });
    return ContactStore.of({
      get: (id) =>
        Effect.sync(() => {
          const contact = rows.get(id);
          return contact === undefined ? undefined : copy(contact);
        }),
      list: (owner, page) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter(
              (contact) =>
                sameOwner(contact, owner) &&
                (page.after === undefined ||
                  contact.createdAt > page.after.createdAt ||
                  (contact.createdAt === page.after.createdAt && contact.id > page.after.id)),
            )
            .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1))
            .slice(0, page.size)
            .map(copy),
        ),
      primaryFor: (owner, type, purpose, verifiedOnly) =>
        Effect.sync(() => {
          const contact = [...rows.values()].find(
            (row) =>
              sameOwner(row, owner) &&
              row.type === type &&
              row.primaryPurposes.includes(purpose) &&
              (!verifiedOnly || row.verifiedAt !== null),
          );
          return contact === undefined ? undefined : copy(contact);
        }),
      insert: Effect.fn("ContactStore.memory.insert")(function* (contact) {
        const inserted = yield* change(() => {
          if (
            rows.has(contact.id) ||
            [...rows.values()].some(
              (row) =>
                sameOwner(row, contact.owner) &&
                row.type === contact.type &&
                row.valueNormalized !== null &&
                row.valueNormalized === contact.valueNormalized,
            )
          )
            return false;
          rows.set(contact.id, copy({ ...contact, primaryPurposes: [] }));
          return true;
        });
        if (!inserted) return yield* new ContactConflict();
      }),
      remove: (id) =>
        change(() => {
          tokens.delete(id);
          return rows.delete(id);
        }),
      setPrimary: (id, purposes) =>
        change(() => {
          const contact = rows.get(id);
          if (!contact) return undefined;
          const selected = (purposes ?? contact.purposes).filter((purpose) =>
            contact.purposes.includes(purpose),
          );
          const previousContactIds = Object.fromEntries(
            selected
              .filter((purpose) => !contact.primaryPurposes.includes(purpose))
              .map((purpose) => [purpose, null as string | null]),
          );
          for (const row of rows.values()) {
            if (row.id === id || !sameOwner(row, contact.owner) || row.type !== contact.type)
              continue;
            for (const purpose of row.primaryPurposes)
              if (selected.includes(purpose)) previousContactIds[purpose] = row.id;
            rows.set(row.id, {
              ...row,
              primaryPurposes: row.primaryPurposes.filter((purpose) => !selected.includes(purpose)),
            });
          }
          const primary = {
            ...contact,
            primaryPurposes: contact.purposes.filter(
              (purpose) => selected.includes(purpose) || contact.primaryPurposes.includes(purpose),
            ),
          };
          rows.set(id, primary);
          return { contact: copy(primary), previousContactIds };
        }),
      importVerified: (contact) =>
        change(() => {
          const existing = [...rows.values()].find(
            (row) =>
              sameOwner(row, contact.owner) &&
              row.type === contact.type &&
              row.valueNormalized === contact.valueNormalized,
          );
          if (!existing) {
            rows.set(contact.id, copy({ ...contact, primaryPurposes: [] }));
            return { contact: copy(contact), added: true, verified: true };
          }
          const verified = existing.verifiedAt === null;
          const result = verified ? { ...existing, verifiedAt: contact.verifiedAt } : existing;
          if (verified) {
            rows.set(existing.id, result);
            tokens.delete(existing.id);
          }
          return { contact: copy(result), added: false, verified };
        }),
      replaceToken: (id, hash, expiresAt) =>
        change(() => {
          if (!rows.has(id)) return false;
          tokens.set(id, { hash, expiresAt });
          return true;
        }),
      consumeToken: (hash, now) =>
        change(() => {
          for (const [id, token] of tokens) {
            if (token.hash !== hash || token.expiresAt <= now) continue;
            const contact = rows.get(id);
            if (!contact) return undefined;
            tokens.delete(id);
            const verified = { ...contact, verifiedAt: now };
            rows.set(id, verified);
            return copy(verified);
          }
          return undefined;
        }),
      erase: (owner) =>
        change(() => {
          for (const row of rows.values())
            if (sameOwner(row, owner)) {
              rows.delete(row.id);
              tokens.delete(row.id);
            }
        }),
    });
  });
