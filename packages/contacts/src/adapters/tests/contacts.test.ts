import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  type AddContact,
  ContactConflict,
  ContactInputInvalid,
  ContactNotFound,
  ContactOwners,
  Contacts,
  ContactStore,
  VerificationInvalid,
} from "../../index.js";
import { stores } from "./stores.js";
const actor = (id: string) => Actor.make({ id: ActorId.make(id) });
const alice = actor("alice");
const bob = actor("bob");
const owner = { kind: "person", id: "alice" };
const access = Layer.succeed(ContactOwners, {
  access: (person, ref) =>
    Effect.succeed(
      person.id === ref.id
        ? "write"
        : person.id === "reader" && ref.id === "alice"
          ? "read"
          : "none",
    ),
});
const options = {
  allowedTypes: ["email", "phone", "postal"],
  purposes: ["general", "billing"],
  verificationTokenTtlMs: 1000,
  maxPageSize: 2,
} as const;
const input = (value: string): AddContact => ({
  owner,
  type: "email",
  value,
  purposes: ["general"],
});
for (const { name, layer: storage } of stores) {
  const world = Contacts.layer(options).pipe(Layer.provide(access), Layer.provideMerge(storage));
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Contacts on ${name}`,
    (it) => {
      it.effect(
        "normalizes email and phone, preserves permissive postal details, and caps pages",
        () =>
          Effect.gen(function* () {
            const service = yield* Contacts;
            const email = yield* UnitOfWork.atomic(
              service.addContact(alice, input("  ALICE@Example.COM  ")),
            );
            expect(email.contact.valueNormalized).toBe("alice@example.com");
            expect(email.events).toEqual([
              { kind: "ContactAdded", contactId: email.contact.id, owner, type: "email" },
            ]);
            expect(
              yield* Effect.flip(
                UnitOfWork.atomic(service.addContact(alice, input("alice@example.com"))),
              ),
            ).toBeInstanceOf(ContactConflict);
            const phone = yield* UnitOfWork.atomic(
              service.addContact(alice, {
                owner,
                type: "phone",
                value: " +48 123 456 ",
                purposes: ["billing"],
              }),
            );
            expect(phone.contact.valueNormalized).toBe("+48123456");
            const details = { lines: ["1 Main St"], locality: "Town", custom: { door: 2 } };
            const postal = yield* UnitOfWork.atomic(
              service.addContact(alice, { owner, type: "postal", details, purposes: ["billing"] }),
            );
            expect(postal.contact.valueNormalized).toBeNull();
            expect(postal.contact.details).toEqual(details);
            const first = yield* service.listFor(alice, owner, { size: 100 });
            expect(first.contacts).toHaveLength(2);
            expect(first.next).toBeDefined();
            if (!first.next) return yield* Effect.die("Expected another page.");
            const second = yield* service.listFor(alice, owner, { cursor: first.next });
            expect(second.contacts).toHaveLength(1);
            expect(second.next).toBeUndefined();
            expect(
              new Set([...first.contacts, ...second.contacts].map((contact) => contact.id)).size,
            ).toBe(3);
            yield* UnitOfWork.atomic(service.erase(owner));
          }),
      );
      it.effect(
        "hides denied and missing owners, supports read-only access and rejects all unauthorized mutations",
        () =>
          Effect.gen(function* () {
            const service = yield* Contacts;
            const added = yield* UnitOfWork.atomic(
              service.addContact(alice, input("privacy@example.com")),
            );
            expect(yield* Effect.flip(service.listFor(bob, owner))).toBeInstanceOf(ContactNotFound);
            expect(
              yield* Effect.flip(service.listFor(bob, { kind: "person", id: "missing" })),
            ).toBeInstanceOf(ContactNotFound);
            expect((yield* service.listFor(actor("reader"), owner)).contacts).toHaveLength(1);
            expect(
              yield* Effect.flip(service.primaryFor(bob, owner, "email", "general", false)),
            ).toBeInstanceOf(ContactNotFound);
            for (const person of [bob, actor("reader")]) {
              for (const write of [
                service.addContact(person, input("denied@example.com")).pipe(Effect.asVoid),
                service.removeContact(person, added.contact.id).pipe(Effect.asVoid),
                service.setPrimary(person, added.contact.id).pipe(Effect.asVoid),
                service.requestVerification(person, added.contact.id).pipe(Effect.asVoid),
              ])
                expect(yield* Effect.flip(UnitOfWork.atomic(write))).toBeInstanceOf(
                  ContactNotFound,
                );
            }
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.removeContact(alice, "missing"))),
            ).toBeInstanceOf(ContactNotFound);
            yield* UnitOfWork.atomic(service.erase(owner));
          }),
      );
      it.effect(
        "returns token-free request facts, rotates tokens, consumes once, and requires verified primaries",
        () =>
          Effect.gen(function* () {
            const service = yield* Contacts;
            const added = yield* UnitOfWork.atomic(
              service.addContact(alice, { ...input("verify@example.com"), primary: true }),
            );
            const id = added.contact.id;
            const requested = yield* UnitOfWork.atomic(service.requestVerification(alice, id));
            expect(requested).toEqual({
              contactId: id,
              events: [{ kind: "VerificationRequested", contactId: id }],
            });
            expect(yield* service.primaryFor(null, owner, "email", "general", true)).toBeNull();
            const first = yield* UnitOfWork.atomic(service.issueVerificationToken(id));
            const second = yield* UnitOfWork.atomic(service.issueVerificationToken(id));
            expect(first.token).not.toBe(second.token);
            expect(first.token).toMatch(/^[a-f0-9]{64}$/);
            expect(second.events).toEqual([]);
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.verify(first.token))),
            ).toBeInstanceOf(VerificationInvalid);
            expect(yield* Effect.flip(UnitOfWork.atomic(service.verify("unknown")))).toBeInstanceOf(
              VerificationInvalid,
            );
            const verified = yield* UnitOfWork.atomic(service.verify(second.token));
            expect(verified.contact.verifiedAt).not.toBeNull();
            expect(verified.events).toEqual([{ kind: "ContactVerified", contactId: id }]);
            expect(JSON.stringify(verified)).not.toContain(second.token);
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.verify(second.token))),
            ).toBeInstanceOf(VerificationInvalid);
            expect((yield* service.primaryFor(null, owner, "email", "general", true))?.id).toBe(id);
            const removed = yield* UnitOfWork.atomic(service.removeContact(alice, id));
            expect(removed.events).toEqual([{ kind: "ContactRemoved", contactId: id, owner }]);
            expect(yield* service.primaryFor(null, owner, "email", "general", false)).toBeNull();
          }),
      );
      it.effect("returns PrimaryChanged only when a selected purpose moves", () =>
        Effect.gen(function* () {
          const service = yield* Contacts;
          const first = yield* UnitOfWork.atomic(
            service.addContact(alice, {
              ...input("primary-first@example.com"),
              purposes: ["general", "billing"],
            }),
          );
          const second = yield* UnitOfWork.atomic(
            service.addContact(alice, {
              ...input("primary-second@example.com"),
              purposes: ["general", "billing"],
            }),
          );
          const selected = yield* UnitOfWork.atomic(service.setPrimary(alice, first.contact.id));
          expect(selected.events).toEqual([
            {
              kind: "PrimaryChanged",
              contactId: first.contact.id,
              owner,
              previousContactIds: { general: null, billing: null },
            },
          ]);
          expect(yield* UnitOfWork.atomic(service.setPrimary(alice, first.contact.id))).toEqual({
            contact: selected.contact,
            events: [],
          });
          expect(
            (yield* UnitOfWork.atomic(service.setPrimary(alice, first.contact.id, ["general"])))
              .events,
          ).toEqual([]);
          const moved = yield* UnitOfWork.atomic(
            service.setPrimary(alice, second.contact.id, ["general"]),
          );
          expect(moved.events).toEqual([
            {
              kind: "PrimaryChanged",
              contactId: second.contact.id,
              owner,
              previousContactIds: { general: first.contact.id },
            },
          ]);
          expect((yield* service.primaryFor(null, owner, "email", "billing", false))?.id).toBe(
            first.contact.id,
          );
          expect(
            yield* UnitOfWork.atomic(service.setPrimary(alice, second.contact.id, ["general"])),
          ).toEqual({
            contact: moved.contact,
            events: [],
          });
          yield* UnitOfWork.atomic(service.erase(owner));
        }),
      );
      it.effect("rejects expired tokens using the persisted deadline", () =>
        Effect.gen(function* () {
          const service = yield* Contacts;
          const store = yield* ContactStore;
          const added = yield* UnitOfWork.atomic(
            service.addContact(alice, input("expired@example.com")),
          );
          const issued = yield* UnitOfWork.atomic(service.issueVerificationToken(added.contact.id));
          const hash = Array.from(
            new Uint8Array(
              yield* Effect.promise(() =>
                globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(issued.token)),
              ),
            ),
          )
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          yield* UnitOfWork.atomic(store.replaceToken(added.contact.id, hash, 0));
          expect(
            yield* Effect.flip(UnitOfWork.atomic(service.verify(issued.token))),
          ).toBeInstanceOf(VerificationInvalid);
          yield* UnitOfWork.atomic(service.erase(owner));
        }),
      );
      it.effect("validates vocabulary and leaves phone verification deferred", () =>
        Effect.gen(function* () {
          const service = yield* Contacts;
          for (const value of [
            { ...input("") },
            { ...input("x"), purposes: ["unknown"] },
            { ...input("x"), purposes: ["general", "general"] },
            { owner, type: "postal" as const, value: "not-postal", purposes: ["general"] },
          ])
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.addContact(alice, value))),
            ).toBeInstanceOf(ContactInputInvalid);
          const phone = yield* UnitOfWork.atomic(
            service.addContact(alice, {
              owner,
              type: "phone",
              value: "123",
              purposes: ["general"],
            }),
          );
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(service.requestVerification(alice, phone.contact.id)),
            ),
          ).toBeInstanceOf(ContactInputInvalid);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(service.issueVerificationToken(phone.contact.id))),
          ).toBeInstanceOf(ContactInputInvalid);
          expect(yield* Effect.flip(service.listFor(alice, owner, { size: 0 }))).toBeInstanceOf(
            ContactInputInvalid,
          );
          yield* UnitOfWork.atomic(service.erase(owner));
        }),
      );
    },
  );
}
