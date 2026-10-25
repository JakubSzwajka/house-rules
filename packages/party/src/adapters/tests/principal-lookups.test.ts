import { expect, it, layer } from "@effect/vitest";
import {
  Approval,
  CurrentActor,
  defineFeature,
  Forbidden,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  Party,
  PartyInputInvalid,
  PartyMount,
  PartyOperations,
  PartyStore,
  PersonNotFound,
} from "../../index.js";
import { principalsTesting } from "./principals-testing.js";
import { stores } from "./stores.js";

const find = defineFeature("lookup_find", {
  ...PartyOperations.findPrincipal,
  permission: null,
  flags: { readOnly: true },
  edges: [PartyOperations.findPrincipal],
  handler: (input, { call }) => call(PartyOperations.findPrincipal, input),
});
const systemFind = defineFeature("lookup_system_find", {
  ...PartyOperations.findPrincipal,
  permission: null,
  flags: { readOnly: true },
  start: { kind: "system", reason: "Process directory lookup", startedBy: "tests" },
  edges: [PartyOperations.findPrincipal],
  handler: (input, { call }) => call(PartyOperations.findPrincipal, input),
});
const holders = defineFeature("lookup_holders", {
  ...PartyOperations.holdersOf,
  permission: null,
  flags: { readOnly: true },
  edges: [PartyOperations.holdersOf],
  handler: (input, { call }) => call(PartyOperations.holdersOf, input),
});
const systemHolders = defineFeature("lookup_system_holders", {
  ...PartyOperations.holdersOf,
  permission: null,
  flags: { readOnly: true },
  start: { kind: "system", reason: "Find process owner", startedBy: "tests" },
  edges: [PartyOperations.holdersOf],
  handler: (input, { call }) => call(PartyOperations.holdersOf, input),
});
const { create, disable, input, actor } = principalsTesting;
const features = [...principalsTesting.features, find, systemFind, holders, systemHolders];
const system = { kind: "system", reason: "Seed assignments", startedBy: "tests" } as const;
const access = (granted: boolean) =>
  Layer.succeedContext(
    May.context(May.fixed(granted ? ["party:read"] : []), {
      features,
      system: granted ? ["party:read", "party:create", "party:update"] : [],
      via: "test",
    }),
  );

for (const { name, layer: storage } of stores) {
  const world = (holdersLimit?: number) =>
    Runtime.layer({ mounts: [PartyMount], features, ways: [] }).pipe(
      Layer.provideMerge(
        Party.layer({
          builtInRoles: {
            owner: { name: "Owner", permissions: ["party:read"] },
            other: { name: "Other", permissions: ["party:read"] },
          },
          ...(holdersLimit === undefined ? {} : { holdersLimit }),
        }).pipe(Layer.provideMerge(storage)),
      ),
      Layer.provideMerge(StepTrace.layer()),
      Layer.provideMerge(
        Layer.mergeAll(Layer.succeed(CurrentActor, actor), Approval.allowAll, access(true)),
      ),
    );
  layer(world(2), { excludeTestServices: true, timeout: "30 seconds" })(
    `Principal lookups on ${name}`,
    (test) => {
      test.effect("reads exact handles for both callers, including disabled principals", () =>
        Effect.gen(function* () {
          for (const kind of ["person", "agent"] as const) {
            const created = yield* runFeature(create, input(`lookup-${kind}`, kind));
            for (const feature of [find, systemFind]) {
              expect(yield* runFeature(feature, { handle: created.principal.handle })).toEqual(
                created.principal,
              );
              for (const handle of ["lookup-absent", created.principal.id, `LOOKUP-${kind}`]) {
                expect(yield* Effect.flip(runFeature(feature, { handle }))).toBeInstanceOf(
                  PersonNotFound,
                );
              }
            }
            const disabled = yield* runFeature(disable, { id: created.principal.id });
            for (const feature of [find, systemFind]) {
              expect(yield* runFeature(feature, { handle: created.principal.handle })).toEqual(
                disabled.principal,
              );
            }
          }
          const another = Actor.make({ id: ActorId.make("lookup-another-caller") });
          expect(
            yield* runFeature(find, { handle: "lookup-agent" }).pipe(
              Effect.provideService(CurrentActor, another),
            ),
          ).toMatchObject({ handle: "lookup-agent", disabledAt: expect.any(Number) });
        }),
      );
      test.effect("uses party:read gates for person and system callers", () =>
        Effect.gen(function* () {
          for (const feature of [find, systemFind]) {
            expect(
              yield* Effect.flip(
                runFeature(feature, { handle: "not-even-looked-up" }).pipe(
                  Effect.provide(access(false)),
                ),
              ),
            ).toBeInstanceOf(Forbidden);
          }
          for (const feature of [holders, systemHolders]) {
            expect(
              yield* Effect.flip(
                runFeature(feature, { role: "owner" }).pipe(Effect.provide(access(false))),
              ),
            ).toBeInstanceOf(Forbidden);
          }
          for (const operation of [PartyOperations.findPrincipal, PartyOperations.holdersOf]) {
            expect(operation.permission).toBe("party:read");
            expect(operation.readOnly).toBe(true);
            expect(operation.transactional).toBe(false);
            expect(operation.destructive).toBe(false);
            expect(operation.needsApproval).toBe(false);
            expect(operation.edges).toEqual([]);
          }
        }),
      );
      test.effect(
        "returns exact scopes in id order, with empty, exact-limit and truncated results",
        () =>
          Effect.gen(function* () {
            const party = yield* Party;
            const store = yield* PartyStore;
            const ids = [
              ActorId.make("holder-z"),
              ActorId.make("holder-a"),
              ActorId.make("holder-m"),
            ] as const;
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                for (const id of ids) yield* party.createPerson({ id, displayName: id });
                for (const id of ["scope-a", "scope-b"]) {
                  yield* store.insertOrganisation({ id, name: id });
                }
                yield* store.putRole({
                  key: "custom-holder",
                  name: "Custom holder",
                  permissions: ["party:read"],
                  organisationId: "scope-a",
                  builtIn: false,
                });
                for (const personId of ids) {
                  yield* party.assignRole(system, {
                    personId,
                    roleKey: "owner",
                    organisationId: null,
                  });
                  yield* party.assignRole(system, {
                    personId,
                    roleKey: "owner",
                    organisationId: "scope-a",
                  });
                  yield* party.assignRole(system, {
                    personId,
                    roleKey: "custom-holder",
                    organisationId: "scope-a",
                  });
                }
                for (const personId of ids.slice(0, 2)) {
                  yield* party.assignRole(system, {
                    personId,
                    roleKey: "owner",
                    organisationId: "scope-b",
                  });
                }
                yield* party.assignRole(system, {
                  personId: ids[0],
                  roleKey: "owner",
                  organisationId: null,
                });
                yield* party.assignRole(system, {
                  personId: ids[0],
                  roleKey: "other",
                  organisationId: null,
                });
              }),
            );
            expect(yield* store.holderIds("owner", null, 1)).toEqual([ids[1]]);
            // Disabled holders remain assignment facts, not a grant of authority.
            yield* runFeature(disable, { id: ids[1] });
            for (const feature of [holders, systemHolders]) {
              const global = { ids: [ids[1], ids[2]], truncated: true };
              expect(yield* runFeature(feature, { role: "owner" })).toEqual(global);
              expect(yield* runFeature(feature, { role: "owner", scope: null })).toEqual(global);
              expect(yield* runFeature(feature, { role: "owner", scope: "scope-a" })).toEqual(
                global,
              );
              expect(
                yield* runFeature(feature, { role: "custom-holder", scope: "scope-a" }),
              ).toEqual(global);
              expect(yield* runFeature(feature, { role: "custom-holder" })).toEqual({
                ids: [],
                truncated: false,
              });
              expect(yield* runFeature(feature, { role: "owner", scope: "scope-b" })).toEqual({
                ids: [ids[1], ids[0]],
                truncated: false,
              });
              expect(yield* runFeature(feature, { role: "other" })).toEqual({
                ids: [ids[0]],
                truncated: false,
              });
              for (const lookup of [{ role: "absent" }, { role: "owner", scope: "absent" }]) {
                expect(yield* runFeature(feature, lookup)).toEqual({ ids: [], truncated: false });
              }
              expect(yield* runFeature(feature, { role: "owner" })).toEqual(global);
            }
          }),
      );
    },
  );
}

it.effect("rejects invalid holder limits when acquiring Party", () =>
  Effect.gen(function* () {
    for (const holdersLimit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const result = yield* Effect.flip(
        Effect.scoped(Layer.build(Party.layerMemory({ builtInRoles: {}, holdersLimit }))),
      );
      expect(result).toBeInstanceOf(PartyInputInvalid);
    }
  }),
);
