import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import { person, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import * as Contacts from "../index.ts";

class Model extends Domain.Model("ContactsBook", {
  aggregates: [...Contacts.aggregates],
  policies: [...Contacts.policies],
}) {}

const story = Story.make(Model, { layer: Contacts.handlers, stub: [Contacts.VerificationCodes] });
const { ContactBook, ContactBookId, ContactsPermissions: P } = Contacts;
const book = ContactBook.ref(ContactBookId.make("ann"));
const ann = person("ann", { permissions: [P.write] });
const email = (contactId: string, value: string, purposes: ReadonlyArray<string> = ["general"]) =>
  new Contacts.ContactAdded({ contactId, type: "email", value, details: {}, purposes, by: "ann" });
const addEmail = (contactId: string, value: string, purposes = ["general"], primary = false) =>
  new Contacts.AddContact({ contactId, type: "email", value, purposes, primary });

describe("ContactBook", () => {
  it("the model is well defined", () => expect(Domain.verify(Model)).toEqual([]));

  it.effect("adds a normalized email and can make it primary at once", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(book, addEmail("c1", "  Ann@Example.COM ", ["general", "general"], true)),
      Story.then(
        book,
        email("c1", "ann@example.com"),
        new Contacts.PrimaryContactChanged({
          contactId: "c1",
          previous: { general: null },
          by: "ann",
        }),
      ),
      Story.state(book, (s) => {
        expect(s.contacts.c1).toMatchObject({ primaryFor: ["general"], verifiedAt: null });
      }),
    ),
  );

  it.effect("refuses a taken id or an address the book already holds", () =>
    story(
      Story.given(book, email("c1", "ann@example.com")),
      Story.provide(CurrentActor, ann),
      Story.when(book, addEmail("c1", "other@example.com")),
      Story.rejected(new Contacts.DuplicateContact({ contactId: "c1" })),
      Story.when(book, addEmail("c2", "ANN@example.com")),
      Story.rejected(new Contacts.DuplicateContact({ contactId: "c1" })),
    ),
  );

  it.effect("checks values against the contact type", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(
        book,
        new Contacts.AddContact({ contactId: "p1", type: "postal", purposes: ["home"] }),
      ),
      Story.then(
        book,
        new Contacts.ContactAdded({
          contactId: "p1",
          type: "postal",
          value: null,
          details: {},
          purposes: ["home"],
          by: "ann",
        }),
      ),
      Story.when(
        book,
        new Contacts.AddContact({
          contactId: "p2",
          type: "postal",
          value: "x",
          purposes: ["home"],
        }),
      ),
      Story.rejected(new Contacts.InvalidContact({ reason: "value-not-allowed" })),
      Story.when(
        book,
        new Contacts.AddContact({
          contactId: "t1",
          type: "phone",
          value: "   ",
          purposes: ["home"],
        }),
      ),
      Story.rejected(new Contacts.InvalidContact({ reason: "value-required" })),
    ),
  );

  it.effect("only the owner, or an org manager for an org book, may change a book", () =>
    story(
      Story.provide(CurrentActor, person("bob")),
      Story.when(book, addEmail("c1", "ann@example.com")),
      Story.rejected(new Forbidden({ permission: P.write })),
      Story.provide(CurrentActor, person("bob", { permissions: [P.write] })),
      Story.when(book, addEmail("c1", "ann@example.com")),
      Story.rejected(new Contacts.NotContactOwner()),
      Story.provide(CurrentActor, system("importer", [P.write])),
      Story.when(book, addEmail("c1", "ann@example.com")),
      Story.rejected(new Contacts.NotContactOwner()),
      Story.provide(CurrentActor, person("ann", { orgId: "acme", permissions: [P.write] })),
      Story.when(ContactBook.ref(ContactBookId.make("acme")), addEmail("c1", "billing@acme.test")),
      Story.rejected(new Contacts.NotContactOwner()),
      Story.provide(
        CurrentActor,
        person("ann", { orgId: "acme", permissions: [P.write, P.manageOrg] }),
      ),
      Story.when(ContactBook.ref(ContactBookId.make("acme")), addEmail("c1", "billing@acme.test")),
      Story.then(ContactBook.ref(ContactBookId.make("acme")), email("c1", "billing@acme.test")),
    ),
  );

  it.effect("moves only the selected purposes to the new primary", () =>
    story(
      Story.given(
        book,
        email("a", "a@example.com", ["general", "billing"]),
        new Contacts.PrimaryContactChanged({
          contactId: "a",
          previous: { general: null, billing: null },
          by: "ann",
        }),
        email("b", "b@example.com", ["general"]),
      ),
      Story.provide(CurrentActor, ann),
      Story.when(book, new Contacts.SetPrimaryContact({ contactId: "b" })),
      Story.then(
        book,
        new Contacts.PrimaryContactChanged({
          contactId: "b",
          previous: { general: "a" },
          by: "ann",
        }),
      ),
      Story.state(book, (s) => {
        expect(s.contacts.a?.primaryFor).toEqual(["billing"]);
        expect(s.contacts.b?.primaryFor).toEqual(["general"]);
      }),
      Story.when(book, new Contacts.SetPrimaryContact({ contactId: "b", purposes: ["general"] })),
      Story.then(book),
      Story.when(book, new Contacts.SetPrimaryContact({ contactId: "b", purposes: ["billing"] })),
      Story.rejected(new Contacts.InvalidContact({ reason: "purpose-not-offered" })),
      Story.when(book, new Contacts.SetPrimaryContact({ contactId: "zz" })),
      Story.rejected(new Contacts.ContactNotFound({ contactId: "zz" })),
    ),
  );

  it.effect("removes a contact and its primary claims", () =>
    story(
      Story.given(
        book,
        email("a", "a@example.com"),
        new Contacts.PrimaryContactChanged({
          contactId: "a",
          previous: { general: null },
          by: "ann",
        }),
      ),
      Story.provide(CurrentActor, ann),
      Story.when(book, new Contacts.RemoveContact({ contactId: "a" })),
      Story.then(book, new Contacts.ContactRemoved({ contactId: "a", by: "ann" })),
      Story.state(book, { contacts: {} }),
      Story.when(book, new Contacts.RemoveContact({ contactId: "a" })),
      Story.rejected(new Contacts.ContactNotFound({ contactId: "a" })),
    ),
  );
});

describe("ImportVerifiedContact", () => {
  const importer = system("identity", [P.import]);
  const imported = (contactId: string) =>
    new Contacts.ImportVerifiedContact({
      contactId,
      email: "Ann@Example.com",
      purposes: ["general"],
      primary: true,
    });
  const verified = (contactId: string) =>
    new Contacts.ContactVerified({ contactId, by: "system:identity" });

  it.effect("adds a verified primary email once, and a retry records nothing", () =>
    story(
      Story.provide(CurrentActor, importer),
      Story.when(book, imported("c1")),
      Story.then(
        book,
        new Contacts.ContactAdded({ ...email("c1", "ann@example.com"), by: "system:identity" }),
        verified("c1"),
        new Contacts.PrimaryContactChanged({
          contactId: "c1",
          previous: { general: null },
          by: "system:identity",
        }),
      ),
      Story.when(book, imported("c1")),
      Story.then(book),
    ),
  );

  it.effect("verifies the address the book already holds, keeping its id", () =>
    story(
      Story.given(book, email("old", "ann@example.com")),
      Story.provide(CurrentActor, importer),
      Story.when(
        book,
        new Contacts.ImportVerifiedContact({
          contactId: "new",
          email: "ann@example.com",
          purposes: ["general"],
        }),
      ),
      Story.then(book, verified("old")),
    ),
  );

  it.effect("refuses an id another address holds, and callers without the grant", () =>
    story(
      Story.given(book, email("c1", "other@example.com")),
      Story.provide(CurrentActor, importer),
      Story.when(book, imported("c1")),
      Story.rejected(new Contacts.DuplicateContact({ contactId: "c1" })),
      Story.provide(CurrentActor, ann),
      Story.when(book, imported("c2")),
      Story.rejected(new Forbidden({ permission: P.import })),
    ),
  );
});

describe("primaryOf", () => {
  it.effect("finds the primary contact for a purpose, verified only when asked", () =>
    story(
      Story.given(
        book,
        email("a", "a@example.com"),
        new Contacts.PrimaryContactChanged({
          contactId: "a",
          previous: { general: null },
          by: "ann",
        }),
      ),
      Story.state(book, (s) => {
        expect(Contacts.primaryOf(s, "email", "general")?.id).toBe("a");
        expect(Contacts.primaryOf(s, "email", "general", { verifiedOnly: true })).toBeUndefined();
        expect(Contacts.primaryOf(s, "phone", "general")).toBeUndefined();
      }),
    ),
  );
});
