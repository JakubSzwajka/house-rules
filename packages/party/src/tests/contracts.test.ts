import { expect, it } from "@effect/vitest";
import { CurrentActor, Forbidden, Grant, implement } from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  Party,
  PartyPermissions,
  PersonNotFound,
  renamePerson,
  showMe,
  showPerson,
} from "../index.js";

const ada = Actor.make({ id: ActorId.make("ada") });
const grace = Actor.make({ id: ActorId.make("grace") });

const showCapability = implement(showPerson, ({ id }) =>
  Effect.gen(function* () {
    const party = yield* Party;
    return yield* party.get(yield* CurrentActor, id);
  }),
);
const showMeCapability = implement(showMe, () =>
  Effect.gen(function* () {
    const party = yield* Party;
    return yield* party.me(yield* CurrentActor);
  }),
);
const renameCapability = implement(renamePerson, ({ id, displayName }) =>
  Effect.gen(function* () {
    const party = yield* Party;
    return yield* party.rename(yield* CurrentActor, id, displayName);
  }),
);

const world = Party.layerMemory.pipe(Layer.provideMerge(memoryUnitOfWork));
const as = (actor: Actor) => Layer.succeed(CurrentActor, actor);
const holds = Grant.layerFromPermissions(Object.values(PartyPermissions));

it.layer(world)("Party contracts", (test) => {
  test.effect("name, permission and flags are the shipped ones", () =>
    Effect.sync(() => {
      expect(showPerson.name).toBe("show_person");
      expect(showPerson.permission).toBe("party:read");
      expect(showMe.name).toBe("show_me");
      expect(showMe.permission).toBe("party:read");
      expect(showMe.transactional).toBe(false);
      expect(renamePerson.name).toBe("rename_person");
      expect(renamePerson.permission).toBe("party:update");
      expect(renamePerson.transactional).toBe(true);
    }),
  );
  test.effect("both fail with Forbidden under Grant.denyAll, before the module runs", () =>
    Effect.gen(function* () {
      const shown = yield* Effect.flip(
        showCapability
          .handler({ id: ada.id })
          .pipe(Effect.provide(Layer.merge(Grant.denyAll, as(ada)))),
      );
      const renamed = yield* Effect.flip(
        renameCapability
          .handler({ id: ada.id, displayName: "X" })
          .pipe(Effect.provide(Layer.merge(Grant.denyAll, as(ada)))),
      );
      expect(shown).toBeInstanceOf(Forbidden);
      expect(renamed).toBeInstanceOf(Forbidden);
    }),
  );
  test.effect("show_me returns the caller's own person, and not found when there is none", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const lin = Actor.make({ id: ActorId.make("lin") });
      yield* UnitOfWork.atomic(party.createPerson({ id: lin.id, displayName: "Lin" }));
      const mine = yield* showMeCapability
        .handler({})
        .pipe(Effect.provide(Layer.merge(holds, as(lin))));
      expect(mine).toMatchObject({ id: lin.id, displayName: "Lin" });
      const stranger = Actor.make({ id: ActorId.make("stranger") });
      expect(
        yield* Effect.flip(
          showMeCapability.handler({}).pipe(Effect.provide(Layer.merge(holds, as(stranger)))),
        ),
      ).toBeInstanceOf(PersonNotFound);
      expect(
        yield* Effect.flip(
          showMeCapability.handler({}).pipe(Effect.provide(Layer.merge(Grant.denyAll, as(lin)))),
        ),
      ).toBeInstanceOf(Forbidden);
    }),
  );
  test.effect("show and rename run for a granted actor, in their own unit", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      yield* UnitOfWork.atomic(party.createPerson({ id: ada.id, displayName: "Ada" }));
      const withGrace = Layer.merge(holds, as(grace));
      const withAda = Layer.merge(holds, as(ada));
      expect(
        (yield* showCapability.handler({ id: ada.id }).pipe(Effect.provide(withGrace))).displayName,
      ).toBe("Ada");
      expect(
        (yield* renameCapability
          .handler({ id: ada.id, displayName: "Ada L" })
          .pipe(Effect.provide(withAda))).displayName,
      ).toBe("Ada L");
      expect(
        (yield* Effect.flip(
          renameCapability
            .handler({ id: ada.id, displayName: "Hijack" })
            .pipe(Effect.provide(withGrace)),
        ))._tag,
      ).toBe("PersonUpdateRefused");
    }),
  );
});
