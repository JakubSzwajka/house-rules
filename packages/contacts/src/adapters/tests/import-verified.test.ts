import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { ContactInputInvalid, ContactOwners, Contacts, VerificationInvalid } from "../../index.js";
import { stores } from "./stores.js";
const alice = Actor.make({ id: ActorId.make("alice") });
const owner = { kind: "person", id: "alice" };
const input = {
  owner,
  type: "email" as const,
  value: "import@example.com",
  purposes: ["general"],
  verifiedAt: 200,
};
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
for (const { name, layer: storage } of stores) {
  const world = Contacts.layer({
    ...Contacts.presets.default,
    purposes: ["general", "billing"],
  }).pipe(
    Layer.provide(Layer.succeed(ContactOwners, { access: () => Effect.succeed("write") })),
    Layer.provideMerge(storage),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Verified imports on ${name}`,
    (it) => {
      it.effect(
        "verifies existing normalized emails once and preserves their data on retries",
        () =>
          Effect.gen(function* () {
            const service = yield* Contacts;
            const original = yield* UnitOfWork.atomic(
              service.addContact(alice, {
                ...input,
                purposes: ["general", "billing"],
                details: { custom: true },
              }),
            );
            const issued = yield* UnitOfWork.atomic(
              service.issueVerificationToken(original.contact.id),
            );
            const imported = yield* UnitOfWork.atomic(
              service.importVerified({ ...input, value: " IMPORT@Example.COM " }),
            );
            expect(imported.contact).toEqual({ ...original.contact, verifiedAt: 200 });
            expect(imported.events).toEqual([
              { kind: "ContactVerified", contactId: original.contact.id },
            ]);
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.verify(issued.token))),
            ).toBeInstanceOf(VerificationInvalid);
            expect(
              yield* UnitOfWork.atomic(service.importVerified({ ...input, verifiedAt: 999 })),
            ).toEqual({ contact: imported.contact, events: [] });
            const other = yield* UnitOfWork.atomic(
              service.importVerified({ ...input, owner: { kind: "person", id: "other" } }),
            );
            expect(other.contact.id).not.toBe(original.contact.id);
            expect(other.events.map((event) => event.kind)).toEqual([
              "ContactAdded",
              "ContactVerified",
            ]);
            const second = yield* UnitOfWork.atomic(
              service.addContact(alice, {
                ...input,
                value: "second@example.com",
                purposes: ["general", "billing"],
              }),
            );
            yield* UnitOfWork.atomic(service.setPrimary(alice, original.contact.id));
            const selected = yield* UnitOfWork.atomic(
              service.setPrimary(alice, second.contact.id, ["general"]),
            );
            expect(selected.events).toEqual([
              {
                kind: "PrimaryChanged",
                contactId: second.contact.id,
                owner,
                previousContactIds: { general: original.contact.id },
              },
            ]);
            expect((yield* service.primaryFor(null, owner, "email", "billing", true))?.id).toBe(
              original.contact.id,
            );
            for (const purposes of [[], ["unknown"], ["general", "general"]])
              expect(
                yield* Effect.flip(
                  UnitOfWork.atomic(service.setPrimary(alice, second.contact.id, purposes)),
                ),
              ).toBeInstanceOf(ContactInputInvalid);
            const primaryImport = yield* UnitOfWork.atomic(
              service.importVerified({ ...input, verifiedAt: 999, primary: true }),
            );
            expect(primaryImport.events).toEqual([
              {
                kind: "PrimaryChanged",
                contactId: original.contact.id,
                owner,
                previousContactIds: { general: second.contact.id },
              },
            ]);
            expect(primaryImport.contact.primaryPurposes).toEqual(["general", "billing"]);
            expect(
              yield* UnitOfWork.atomic(
                service.importVerified({ ...input, verifiedAt: 999, primary: true }),
              ),
            ).toEqual({ contact: primaryImport.contact, events: [] });
            yield* UnitOfWork.atomic(service.erase(owner));
            yield* UnitOfWork.atomic(service.erase(other.contact.owner));
          }),
      );
      it.effect("requires a unit, validates inputs and rolls back new and existing imports", () =>
        Effect.gen(function* () {
          const service = yield* Contacts;
          expect(yield* Effect.flip(service.importVerified(input))).toBeInstanceOf(NoOpenUnit);
          for (const invalid of [
            { ...input, value: " " },
            { ...input, purposes: ["unknown"] },
            { ...input, purposes: ["general", "general"] },
          ])
            expect(
              yield* Effect.flip(UnitOfWork.atomic(service.importVerified(invalid))),
            ).toBeInstanceOf(ContactInputInvalid);
          const original = yield* UnitOfWork.atomic(service.addContact(alice, input));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* service.importVerified({ ...input, primary: true });
                  yield* service.importVerified({ ...input, value: "rollback@example.com" });
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect((yield* service.listFor(alice, owner)).contacts).toEqual([original.contact]);
          expect(yield* service.primaryFor(null, owner, "email", "general", true)).toBeNull();
          yield* UnitOfWork.atomic(service.erase(owner));
        }),
      );
    },
  );
}
