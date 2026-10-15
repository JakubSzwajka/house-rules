import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  Party,
  PartyPermissions,
  PersonAlreadyExists,
  PersonInputInvalid,
  PersonNotFound,
  PersonUpdateRefused,
  personPolicy,
} from "../index.js";

const ada = Actor.make({ id: ActorId.make("ada") });
const grace = Actor.make({ id: ActorId.make("grace") });
const world = Party.layerMemory.pipe(Layer.provideMerge(memoryUnitOfWork));

it.effect("the who × action table lets anyone read and only the person update", () =>
  Effect.sync(() => {
    expect(personPolicy.table()).toEqual({
      self: { "party:read": true, "party:update": true },
      other: { "party:read": true, "party:update": false },
    });
    expect(PartyPermissions).toEqual({ read: "party:read", update: "party:update" });
  }),
);

it.layer(world)("Party", (test) => {
  test.effect("creates a person with the given id and reads it as any actor", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const created = yield* UnitOfWork.atomic(
        party.createPerson({ id: ada.id, displayName: "  Ada Lovelace  " }),
      );
      expect(created.id).toBe(ada.id);
      expect(created.displayName).toBe("Ada Lovelace");
      expect(yield* party.get(grace, ada.id)).toEqual(created);
    }),
  );
  test.effect("me reads the actor's own person, and fails when the actor has none", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const id = ActorId.make("me-myself");
      const me = Actor.make({ id });
      expect(yield* Effect.flip(party.me(me))).toBeInstanceOf(PersonNotFound);
      const created = yield* UnitOfWork.atomic(party.createPerson({ id, displayName: "Me" }));
      expect(yield* party.me(me)).toEqual(created);
    }),
  );
  test.effect("generates a new id when none is given", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const first = yield* UnitOfWork.atomic(party.createPerson({ displayName: "One" }));
      const second = yield* UnitOfWork.atomic(party.createPerson({ displayName: "Two" }));
      expect(first.id).not.toBe(second.id);
      expect(first.id).toMatch(/^[0-9a-f]{32}$/u);
      expect(yield* party.get(grace, first.id)).toEqual(first);
    }),
  );
  test.effect("refuses a taken id", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      yield* UnitOfWork.atomic(party.createPerson({ id: ActorId.make("dup"), displayName: "A" }));
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(party.createPerson({ id: ActorId.make("dup"), displayName: "B" })),
        ),
      ).toBeInstanceOf(PersonAlreadyExists);
    }),
  );
  test.effect("a person renames themselves; another actor is refused and nothing changes", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const id = ActorId.make("rename-me");
      const me = Actor.make({ id });
      yield* UnitOfWork.atomic(party.createPerson({ id, displayName: "Before" }));
      expect((yield* UnitOfWork.atomic(party.rename(me, id, " After "))).displayName).toBe("After");
      expect(yield* Effect.flip(UnitOfWork.atomic(party.rename(grace, id, "Hijack")))).toEqual(
        new PersonUpdateRefused(),
      );
      expect((yield* party.get(me, id)).displayName).toBe("After");
    }),
  );
  test.effect("a missing person is not found", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const id = ActorId.make("nobody");
      const nobody = Actor.make({ id });
      expect(yield* Effect.flip(party.get(grace, id))).toBeInstanceOf(PersonNotFound);
      expect(yield* Effect.flip(UnitOfWork.atomic(party.rename(nobody, id, "X")))).toBeInstanceOf(
        PersonNotFound,
      );
    }),
  );
  test.effect("display names are trimmed and limited to 1..120 characters", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const id = ActorId.make("names");
      const me = Actor.make({ id });
      const longest = "x".repeat(120);
      expect(
        (yield* UnitOfWork.atomic(party.createPerson({ id, displayName: longest }))).displayName,
      ).toBe(longest);
      for (const bad of ["", "   ", "x".repeat(121)]) {
        expect(
          yield* Effect.flip(UnitOfWork.atomic(party.createPerson({ displayName: bad }))),
        ).toBeInstanceOf(PersonInputInvalid);
        expect(yield* Effect.flip(UnitOfWork.atomic(party.rename(me, id, bad)))).toBeInstanceOf(
          PersonInputInvalid,
        );
      }
      expect((yield* party.get(me, id)).displayName).toBe(longest);
    }),
  );
  test.effect("erase removes the person", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const id = ActorId.make("erase-me");
      yield* UnitOfWork.atomic(party.createPerson({ id, displayName: "Gone" }));
      yield* UnitOfWork.atomic(party.erase(id));
      expect(yield* Effect.flip(party.get(grace, id))).toBeInstanceOf(PersonNotFound);
    }),
  );
  test.effect("all module writes fail outside a unit", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      expect(yield* Effect.flip(party.createPerson({ displayName: "No unit" }))).toBeInstanceOf(
        NoOpenUnit,
      );
      expect(yield* Effect.flip(party.rename(ada, ada.id, "No unit"))).toBeInstanceOf(NoOpenUnit);
      expect(yield* Effect.flip(party.erase(ada.id))).toBeInstanceOf(NoOpenUnit);
    }),
  );
});
