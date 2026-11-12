import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import {
  CurrentActor,
  devTokens,
  Forbidden,
  person,
  Roles,
  sessionClient,
  SessionLive,
  system,
} from "@house-rules/stack";
import * as Contacts from "../index.ts";

class Model extends Domain.Model("ContactsVerification", {
  aggregates: [...Contacts.aggregates],
  policies: [...Contacts.policies],
}) {}
class ContactsApi extends Domain.Api("ContactsApi", {
  model: Model,
  commands: ["AddContact", "RemoveContact", "SetPrimaryContact", "RequestVerification"],
  aggregates: ["ContactBook"],
}) {}

const story = Story.make(Model, { layer: Contacts.handlers, stub: [Contacts.VerificationCodes] });
const { ContactBook, ContactBookId, VerificationCodes, ContactsPermissions: P } = Contacts;
const book = ContactBook.ref(ContactBookId.make("ann"));
const ann = person("ann", { permissions: [P.write] });
const verifier = system("verification", [P.verify]);
const added = new Contacts.ContactAdded({
  contactId: "c1",
  type: "email",
  value: "ann@example.com",
  details: {},
  purposes: ["general"],
  by: "ann",
});
const requested = new Contacts.VerificationRequested({
  contactId: "c1",
  type: "email",
  address: "ann@example.com",
  by: "ann",
});
const request = new Contacts.RequestVerification({ contactId: "c1" });
const sendArgs = {
  book: "ann",
  contactId: "c1",
  address: "ann@example.com",
  type: "email" as const,
};

describe("verification", () => {
  it("the model is well defined", () => expect(Domain.verify(Model)).toEqual([]));

  it.effect("a request asks VerificationCodes to send a code", () =>
    story(
      Story.given(book, added),
      Story.provide(CurrentActor, ann),
      Story.when(book, request),
      Story.then(book, requested),
      Story.call(VerificationCodes.send, sendArgs),
      Story.succeed(VerificationCodes.send, undefined),
    ),
  );

  it.effect("a failed send records nothing, so the owner may ask again", () =>
    story(
      Story.given(book, added),
      Story.provide(CurrentActor, ann),
      Story.when(book, request),
      Story.then(book, requested),
      Story.call(VerificationCodes.send, sendArgs),
      Story.fail(VerificationCodes.send, new Contacts.VerificationNotSent({ reason: "bounced" })),
      Story.then(book),
    ),
  );

  it.effect("refuses postal contacts, strangers and unknown ids; skips verified ones", () =>
    story(
      Story.given(
        book,
        added,
        new Contacts.ContactAdded({ ...added, contactId: "p1", type: "postal", value: null }),
      ),
      Story.provide(CurrentActor, ann),
      Story.when(book, new Contacts.RequestVerification({ contactId: "p1" })),
      Story.rejected(new Contacts.InvalidContact({ reason: "not-verifiable" })),
      Story.when(book, new Contacts.RequestVerification({ contactId: "zz" })),
      Story.rejected(new Contacts.ContactNotFound({ contactId: "zz" })),
      Story.provide(CurrentActor, person("bob", { permissions: [P.write] })),
      Story.when(book, request),
      Story.rejected(new Contacts.NotContactOwner()),
      Story.given(book, new Contacts.ContactVerified({ contactId: "c1", by: "system:x" })),
      Story.provide(CurrentActor, ann),
      Story.when(book, request),
      Story.then(book),
    ),
  );

  it.effect("trusted code with the grant marks the checked address verified, once", () =>
    story(
      Story.clock("2026-03-01T10:00:00Z"),
      Story.given(book, added),
      Story.provide(CurrentActor, verifier),
      Story.when(book, new Contacts.VerifyContact({ contactId: "c1", address: "ann@example.com" })),
      Story.then(
        book,
        new Contacts.ContactVerified({ contactId: "c1", by: "system:verification" }),
      ),
      Story.state(book, (s) => {
        expect(s.contacts.c1?.verifiedAt?.toString()).toContain("2026-03-01T10:00:00");
      }),
      Story.when(book, new Contacts.VerifyContact({ contactId: "c1", address: "ann@example.com" })),
      Story.then(book),
    ),
  );

  it.effect("refuses a code issued for an address the contact no longer has", () =>
    story(
      Story.given(book, added),
      Story.provide(CurrentActor, verifier),
      Story.when(book, new Contacts.VerifyContact({ contactId: "c1", address: "old@example.com" })),
      Story.rejected(new Contacts.ContactNotFound({ contactId: "c1" })),
      Story.provide(CurrentActor, ann),
      Story.when(book, new Contacts.VerifyContact({ contactId: "c1", address: "ann@example.com" })),
      Story.rejected(new Forbidden({ permission: P.verify })),
    ),
  );
});

describe("memoryVerificationCodes", () => {
  it.effect("checks a code once, forgets replaced codes and expires them", () => {
    const sent: Array<Contacts.SentCode> = [];
    const codes = Contacts.memoryVerificationCodes({
      ttl: "10 minutes",
      deliver: (code) => Effect.sync(() => sent.push(code)),
    });
    return Effect.gen(function* () {
      const service = yield* VerificationCodes;
      const invalid = (code: string | undefined) =>
        service.check({ code: code ?? "" }).pipe(Effect.flip);
      yield* service.send(sendArgs);
      yield* service.send(sendArgs);
      expect(yield* invalid(sent[0]?.code)).toBeInstanceOf(Contacts.CodeInvalid);
      expect(yield* service.check({ code: sent[1]?.code ?? "" })).toEqual({
        book: "ann",
        contactId: "c1",
        address: "ann@example.com",
      });
      expect(yield* invalid(sent[1]?.code)).toBeInstanceOf(Contacts.CodeInvalid);
      yield* service.send(sendArgs);
      yield* TestClock.adjust("10 minutes");
      expect(yield* invalid(sent[2]?.code)).toBeInstanceOf(Contacts.CodeInvalid);
    }).pipe(Effect.provide(codes));
  });
});

describe("ContactsApi over Session", () => {
  const roles = Roles.layer({ member: [P.read, P.write], guest: [P.read] });
  const tokens = devTokens({
    "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
    "bob-token": { subject: "bob", orgId: null, roles: ["member"] },
    "eve-token": { subject: "ann", orgId: null, roles: [] },
    "claude-token": {
      subject: "agent:claude",
      orgId: null,
      roles: ["member"],
      agent: { name: "Claude", forPerson: "ann" },
    },
  });

  it.live("an owner adds, verifies through a delivered code and reads the book", () =>
    Effect.gen(function* () {
      const delivered = yield* Deferred.make<Contacts.SentCode>();
      const codes = Contacts.memoryVerificationCodes({
        deliver: (code) => Deferred.succeed(delivered, code).pipe(Effect.asVoid),
      });
      const hosted = Model.layer(Contacts.handlers).pipe(
        Layer.provide(Layer.mergeAll(codes, platformForTests)),
      );
      const World = SessionLive.pipe(
        Layer.provide(Layer.mergeAll(tokens, roles)),
        Layer.provideMerge(Layer.merge(hosted, codes)),
      );
      const as = (token: string) =>
        ContactsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));
      const annBook = ContactBookId.make("ann");

      yield* Effect.gen(function* () {
        const owner = yield* as("ann-token");
        yield* owner.AddContact(annBook, {
          contactId: "c1",
          type: "email",
          value: "Ann@Example.com",
          purposes: ["general"],
          primary: true,
        });
        yield* owner.RequestVerification(annBook, { contactId: "c1" });
        const { code } = yield* Deferred.await(delivered);

        const target = yield* (yield* VerificationCodes).check({ code });
        yield* (yield* ContactBook)
          .send(
            ContactBookId.make(target.book),
            new Contacts.VerifyContact({ contactId: target.contactId, address: target.address }),
          )
          .pipe(Effect.provideService(CurrentActor, verifier));

        const state = yield* owner.ContactBook.get(annBook);
        expect(Contacts.primaryOf(state, "email", "general", { verifiedOnly: true })?.value).toBe(
          "ann@example.com",
        );
        const bob = yield* as("bob-token");
        expect((yield* bob.ContactBook.get(annBook).pipe(Effect.flip))._tag).toBe(
          "NotContactOwner",
        );
        const claude = yield* as("claude-token");
        expect((yield* claude.ContactBook.get(annBook).pipe(Effect.flip))._tag).toBe(
          "NotContactOwner",
        );
        const eve = yield* as("eve-token");
        expect((yield* eve.ContactBook.get(annBook).pipe(Effect.flip))._tag).toBe("Forbidden");
        const stranger = yield* as("nope");
        const anonymous = yield* stranger
          .RemoveContact(annBook, { contactId: "c1" })
          .pipe(Effect.flip);
        expect(anonymous._tag).toBe("Unauthenticated");
      }).pipe(Effect.scoped, Effect.provide(World));
    }),
  );
});
