import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  bindContacts,
  ContactNotFound,
  ContactOwners,
  Contacts,
  ContactsMount,
  ContactsOperations,
} from "../index.js";
import { stores } from "../adapters/tests/stores.js";
expectTypeOf<Parameters<typeof bindContacts>[0]>().toExtend<Contacts["Service"]>();
expectTypeOf<Contacts["Service"]>().toExtend<Parameters<typeof bindContacts>[0]>();
const {
  addContact,
  importVerified,
  listFor,
  requestVerification,
  issueVerificationToken,
  verify,
  primaryFor,
  removeContact,
  setPrimary,
} = ContactsOperations;
const systemStart = {
  kind: "system",
  reason: "Verification delivery",
  startedBy: "hook:verification",
} as const;
const add = defineFeature("test_addContact", {
  ...addContact,
  permission: null,
  edges: [addContact],
  handler: (input, { call }) => call(addContact, input),
});
const imported = defineFeature("test_importVerified", {
  ...importVerified,
  permission: null,
  edges: [importVerified],
  start: systemStart,
  handler: (input, { call }) => call(importVerified, input),
});
const personImport = defineFeature("test_personImportVerified", {
  ...importVerified,
  permission: null,
  edges: [importVerified],
  handler: (input, { call }) => call(importVerified, input),
});
const list = defineFeature("test_listContacts", {
  ...listFor,
  permission: null,
  edges: [listFor],
  handler: (input, { call }) => call(listFor, input),
});
const request = defineFeature("test_requestVerification", {
  ...requestVerification,
  permission: null,
  edges: [requestVerification],
  handler: (input, { call }) => call(requestVerification, input),
});
const issue = defineFeature("test_issueVerificationToken", {
  ...issueVerificationToken,
  permission: null,
  edges: [issueVerificationToken],
  start: systemStart,
  handler: (input, { call }) => call(issueVerificationToken, input),
});
const personIssue = defineFeature("test_personIssueToken", {
  ...issueVerificationToken,
  permission: null,
  edges: [issueVerificationToken],
  handler: (input, { call }) => call(issueVerificationToken, input),
});
const verifyToken = defineFeature("test_verifyContact", {
  ...verify,
  permission: null,
  edges: [verify],
  start: systemStart,
  handler: (input, { call }) => call(verify, input),
});
const primary = defineFeature("test_primaryContact", {
  ...primaryFor,
  permission: null,
  edges: [primaryFor],
  start: systemStart,
  handler: (input, { call }) => call(primaryFor, input),
});
const remove = defineFeature("test_removeContact", {
  ...removeContact,
  permission: null,
  edges: [removeContact],
  handler: (input, { call }) => call(removeContact, input),
});
const select = defineFeature("test_setPrimary", {
  ...setPrimary,
  permission: null,
  edges: [setPrimary],
  handler: (input, { call }) => call(setPrimary, input),
});
const systemList = defineFeature("test_systemListContacts", {
  ...listFor,
  permission: null,
  edges: [listFor],
  start: systemStart,
  handler: (input, { call }) => call(listFor, input),
});
const features = [
  add,
  imported,
  personImport,
  list,
  request,
  issue,
  personIssue,
  verifyToken,
  primary,
  remove,
  select,
  systemList,
];
const permissions = [
  "contacts:read",
  "contacts:write",
  "contacts:verify",
  "contacts:import",
] as const;
const owners = Layer.succeed(ContactOwners, {
  access: (actor, owner) => Effect.succeed(actor.id === owner.id ? "write" : "none"),
});
const caller = (id: string) =>
  Layer.merge(
    Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make(id) })),
    Layer.succeedContext(
      May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
    ),
  );
const owner = { kind: "person", id: "alice" };
for (const { name, layer: storage } of stores) {
  const module = Contacts.layer(Contacts.presets.default).pipe(Layer.provide(owners));
  const world = Runtime.layer({ mounts: [ContactsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(storage),
    Layer.provideMerge(StepTrace.layer()),
  );
  it.layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Contacts operation bindings on ${name}`,
    (test) => {
      test.effect(
        "allows verified imports only from system callers and retries without events",
        () =>
          Effect.gen(function* () {
            const input = {
              owner,
              type: "email" as const,
              value: " LOGIN@Example.com ",
              purposes: ["general"],
              verifiedAt: 123,
              primary: true,
            };
            expect(
              yield* Effect.flip(
                runFeature(personImport, input).pipe(Effect.provide(caller("alice"))),
              ),
            ).toBeInstanceOf(ContactNotFound);
            const first = yield* runFeature(imported, input).pipe(
              Effect.provide(caller("provisioner")),
            );
            expect(first.contact.valueNormalized).toBe("login@example.com");
            expect(first.contact.verifiedAt).toBe(123);
            expect(first.contact.primaryPurposes).toEqual(["general"]);
            expect(first.events).toEqual([
              { kind: "ContactAdded", contactId: first.contact.id, owner, type: "email" },
              { kind: "ContactVerified", contactId: first.contact.id },
              {
                kind: "PrimaryChanged",
                contactId: first.contact.id,
                owner,
                previousContactIds: { general: null },
              },
            ]);
            const retry = yield* runFeature(imported, {
              ...input,
              value: "login@example.com",
              verifiedAt: 456,
            }).pipe(Effect.provide(caller("provisioner")));
            expect(retry).toEqual({ contact: first.contact, events: [] });
            yield* runFeature(remove, { contactId: first.contact.id }).pipe(
              Effect.provide(caller("alice")),
            );
          }),
      );
      test.effect(
        "mounts all operations and runs token-free requests through a fresh system verification",
        () =>
          Effect.gen(function* () {
            expect(ContactsMount.service).toBe(Contacts);
            expect(ContactsMount.operations).toEqual(Object.values(ContactsOperations));
            expect(ContactsMount.bind).toBe(bindContacts);
            const added = yield* runFeature(add, {
              owner,
              type: "email",
              value: "ALICE@Example.com",
              purposes: ["general"],
            }).pipe(Effect.provide(caller("alice")));
            const contactId = added.contact.id;
            expect(
              yield* runFeature(request, { contactId }).pipe(Effect.provide(caller("alice"))),
            ).toEqual({ contactId, events: [{ kind: "VerificationRequested", contactId }] });
            yield* runFeature(select, { contactId }).pipe(Effect.provide(caller("alice")));
            expect(
              yield* Effect.flip(
                runFeature(personIssue, { contactId }).pipe(Effect.provide(caller("alice"))),
              ),
            ).toBeInstanceOf(ContactNotFound);
            const issued = yield* runFeature(issue, { contactId }).pipe(
              Effect.provide(caller("alice")),
            );
            expect(issued.events).toEqual([]);
            const verified = yield* runFeature(verifyToken, { token: issued.token }).pipe(
              Effect.provide(caller("unsigned-clicker")),
            );
            expect(verified.contact.verifiedAt).not.toBeNull();
            expect(
              (yield* runFeature(primary, {
                owner,
                type: "email",
                purpose: "general",
                verifiedOnly: true,
              }).pipe(Effect.provide(caller("delivery"))))?.id,
            ).toBe(contactId);
            expect(
              yield* Effect.flip(runFeature(list, { owner }).pipe(Effect.provide(caller("bob")))),
            ).toBeInstanceOf(ContactNotFound);
            expect(
              yield* Effect.flip(
                runFeature(systemList, { owner }).pipe(Effect.provide(caller("alice"))),
              ),
            ).toBeInstanceOf(ContactNotFound);
            expect(
              (yield* runFeature(list, { owner }).pipe(Effect.provide(caller("alice")))).contacts,
            ).toHaveLength(1);
            expect(
              yield* Effect.flip(
                runFeature(remove, { contactId }).pipe(Effect.provide(caller("bob"))),
              ),
            ).toBeInstanceOf(ContactNotFound);
          }),
      );
      test.effect("declares permissions and write safety flags", () =>
        Effect.sync(() => {
          for (const operation of [
            addContact,
            importVerified,
            removeContact,
            setPrimary,
            requestVerification,
            issueVerificationToken,
            verify,
          ])
            expect(operation.transactional).toBe(true);
          expect(removeContact.destructive).toBe(true);
          expect(listFor.readOnly).toBe(true);
          expect(primaryFor.readOnly).toBe(true);
          expect(importVerified.permission).toBe("contacts:import");
          expect(issueVerificationToken.permission).toBe("contacts:verify");
          expect(verify.permission).toBe("contacts:verify");
          expect(addContact.permission).toBe("contacts:write");
          expect(listFor.permission).toBe("contacts:read");
        }),
      );
    },
  );
}
