import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineEntry,
  Forbidden,
  May,
  NodeRuntime,
  runEntry,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  bindParty,
  createPerson,
  Party,
  PartyPermissions,
  PersonCallerDenied,
  PersonNotFound,
  PersonUpdateRefused,
  renamePerson,
  showMe,
  showPerson,
} from "../index.js";
import * as contract from "../contract.js";

expectTypeOf<Parameters<typeof bindParty>[0]>().toExtend<Party["Service"]>();
expectTypeOf<Party["Service"]>().toExtend<Parameters<typeof bindParty>[0]>();

const ada = Actor.make({ id: ActorId.make("ada") });
const grace = Actor.make({ id: ActorId.make("grace") });
const show = defineEntry(showPerson);
const mine = defineEntry(showMe);
const rename = defineEntry(renamePerson);
const create = defineEntry(createPerson);
const system = { kind: "system", reason: "test setup", startedBy: "hook:test" } as const;
const systemCreate = defineEntry(createPerson, { start: system });
const systemShow = defineEntry(showPerson, { start: system });
const systemMe = defineEntry(showMe, { start: system });
const systemRename = defineEntry(renamePerson, { start: system });
const entries = [show, mine, rename, create, systemCreate, systemShow, systemMe, systemRename];
const runtime = Layer.unwrap(
  Effect.gen(function* () {
    return NodeRuntime.layer({ bindings: bindParty(yield* Party), entries, ways: [] });
  }),
);
const world = runtime.pipe(
  Layer.provideMerge(Party.layerMemory),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const as = (
  actor: Actor,
  permissions: readonly ("party:read" | "party:update" | "party:create")[] = Object.values(
    PartyPermissions,
  ),
) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(
      May.context(May.fixed(entries, permissions), {
        system: ["party:create", "party:read", "party:update"],
        via: "test",
      }),
    ),
  );

it.layer(world)("Party nodes", (test) => {
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
      expect(createPerson.name).toBe("Party.createPerson");
      expect(createPerson.transactional).toBe(true);
      expect(createPerson.permission).toBe("party:create");
      expect(Object.keys(contract)).not.toContain("bindParty");
      for (const node of [createPerson, showPerson, showMe, renamePerson]) {
        expect(node.edges).toEqual([]);
        expect(node.needsApproval).toBe(false);
      }
    }),
  );
  test.effect("both fail with Forbidden under empty permissions, before the module runs", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(runEntry(show, { id: ada.id }).pipe(Effect.provide(as(ada, [])))),
      ).toBeInstanceOf(Forbidden);
      expect(
        yield* Effect.flip(
          runEntry(rename, { id: ada.id, displayName: "X" }).pipe(Effect.provide(as(ada, []))),
        ),
      ).toBeInstanceOf(Forbidden);
    }),
  );
  test.effect("show_me returns the caller's own person, and not found when there is none", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      const lin = Actor.make({ id: ActorId.make("lin") });
      yield* UnitOfWork.atomic(party.createPerson({ id: lin.id, displayName: "Lin" }));
      expect(yield* runEntry(mine, {}).pipe(Effect.provide(as(lin)))).toMatchObject({
        id: lin.id,
        displayName: "Lin",
      });
      const stranger = Actor.make({ id: ActorId.make("stranger") });
      expect(
        yield* Effect.flip(runEntry(mine, {}).pipe(Effect.provide(as(stranger)))),
      ).toBeInstanceOf(PersonNotFound);
      expect(
        yield* Effect.flip(runEntry(mine, {}).pipe(Effect.provide(as(lin, [])))),
      ).toBeInstanceOf(Forbidden);
    }),
  );
  test.effect("show and rename run for a granted actor, in their own unit", () =>
    Effect.gen(function* () {
      const party = yield* Party;
      yield* UnitOfWork.atomic(party.createPerson({ id: ada.id, displayName: "Ada" }));
      expect(
        (yield* runEntry(show, { id: ada.id }).pipe(Effect.provide(as(grace)))).displayName,
      ).toBe("Ada");
      expect(
        (yield* runEntry(rename, { id: ada.id, displayName: "Ada L" }).pipe(
          Effect.provide(as(ada)),
        )).displayName,
      ).toBe("Ada L");
      expect(
        yield* Effect.flip(
          runEntry(rename, { id: ada.id, displayName: "Hijack" }).pipe(Effect.provide(as(grace))),
        ),
      ).toBeInstanceOf(PersonUpdateRefused);
    }),
  );
  test.effect("creation is system-only; person reads and rename refuse system callers", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          runEntry(create, { displayName: "No" }).pipe(Effect.provide(as(ada, ["party:create"]))),
        ),
      ).toBeInstanceOf(PersonCallerDenied);
      const created = yield* runEntry(systemCreate, { displayName: "System created" }).pipe(
        Effect.provide(as(ada)),
      );
      expect(created.displayName).toBe("System created");
      expect(
        yield* Effect.flip(runEntry(systemShow, { id: created.id }).pipe(Effect.provide(as(ada)))),
      ).toBeInstanceOf(PersonNotFound);
      expect(
        yield* Effect.flip(runEntry(systemMe, {}).pipe(Effect.provide(as(ada)))),
      ).toBeInstanceOf(PersonNotFound);
      expect(
        yield* Effect.flip(
          runEntry(systemRename, { id: created.id, displayName: "No" }).pipe(
            Effect.provide(as(ada)),
          ),
        ),
      ).toBeInstanceOf(PersonUpdateRefused);
    }),
  );
});
