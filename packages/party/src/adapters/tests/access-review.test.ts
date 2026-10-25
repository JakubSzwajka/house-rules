import { expect, layer } from "@effect/vitest";
import {
  Approval,
  PermissionCatalogue,
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { type Permission, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { PartyMount, Party, PartyDenied, PartyOperations } from "../../index.js";
import {
  fixtureTesting,
  partyOptionsTesting,
  systemTesting as system,
} from "./party-access-testing.js";
import { stores } from "./stores.js";

const assign = defineFeature("review_assign", {
  ...PartyOperations.assignRole,
  permission: null,
  edges: [PartyOperations.assignRole],
  handler: (input, { call }) => call(PartyOperations.assignRole, input),
});
const define = defineFeature("review_define", {
  ...PartyOperations.defineRole,
  permission: null,
  edges: [PartyOperations.defineRole],
  handler: (input, { call }) => call(PartyOperations.defineRole, input),
});
const revoke = defineFeature("review_revoke", {
  ...PartyOperations.revokeRole,
  permission: null,
  edges: [PartyOperations.revokeRole],
  handler: (input, { call }) => call(PartyOperations.revokeRole, input),
});
const unrelate = defineFeature("review_unrelate", {
  ...PartyOperations.unrelate,
  permission: null,
  edges: [PartyOperations.unrelate],
  handler: (input, { call }) => call(PartyOperations.unrelate, input),
});
const list = defineFeature("review_list", {
  ...PartyOperations.listRoles,
  permission: null,
  edges: [PartyOperations.listRoles],
  handler: (input, { call }) => call(PartyOperations.listRoles, input),
});
const assignments = defineFeature("review_assignments", {
  ...PartyOperations.rolesOf,
  permission: null,
  edges: [PartyOperations.rolesOf],
  handler: (input, { call }) => call(PartyOperations.rolesOf, input),
});
const features = [assign, define, revoke, unrelate, list, assignments];
const options = {
  builtInRoles: {
    ...partyOptionsTesting.builtInRoles,
    member: { name: "Member", permissions: ["billing:charge"] },
  },
};
const permissions: readonly Permission[] = ["party:admin", "party:read", "billing:charge"];

for (const { name, layer: storage } of stores) {
  const partyLayer = Party.layer(options).pipe(
    Layer.provideMerge(storage),
    Layer.provide(
      Layer.succeed(PermissionCatalogue, { permissions: () => Effect.succeed(permissions) }),
    ),
  );
  const world = Layer.unwrap(
    Effect.gen(function* () {
      return Runtime.layer({ mounts: [PartyMount], features, ways: [] });
    }),
  ).pipe(Layer.provideMerge(partyLayer), Layer.provideMerge(StepTrace.layer()));
  const fixture = fixtureTesting();
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Review regressions on ${name}`,
    (it) => {
      const as = (caller: Parameters<Party["Service"]["listRoles"]>[0]) =>
        Effect.gen(function* () {
          if (caller.kind !== "person") return yield* Effect.die("Expected person fixture");
          return Layer.mergeAll(
            Layer.succeed(CurrentActor, caller.actor),
            Layer.succeedContext(
              May.context(yield* Party.may(), { features, system: [], via: "review" }),
            ),
            Approval.allowAll,
          );
        });
      it.effect(
        "party:admin cannot self-grant a built-in or define/update an unheld custom permission",
        () =>
          Effect.gen(function* () {
            const { party, admin, person, id } = yield* UnitOfWork.atomic(fixture());
            const request = yield* as(admin);
            const assignment = {
              personId: admin.actor.id,
              roleKey: "member",
              organisationId: null,
            };
            const custom = {
              key: id,
              name: "Escalation",
              permissions: ["billing:charge"],
              organisationId: null,
            };
            expect(
              yield* Effect.flip(runFeature(assign, assignment).pipe(Effect.provide(request))),
            ).toBeInstanceOf(PartyDenied);
            expect(
              yield* Effect.flip(runFeature(define, custom).pipe(Effect.provide(request))),
            ).toBeInstanceOf(PartyDenied);
            yield* runFeature(define, { ...custom, permissions: ["party:read"] }).pipe(
              Effect.provide(request),
            );
            yield* runFeature(assign, {
              ...assignment,
              personId: person.actor.id,
              roleKey: id,
            }).pipe(Effect.provide(request));
            expect(
              yield* Effect.flip(runFeature(define, custom).pipe(Effect.provide(request))),
            ).toBeInstanceOf(PartyDenied);
            expect(yield* party.permissionsOf(admin)).toEqual(["party:admin", "party:read"]);
            expect(yield* party.permissionsOf(person)).toEqual(["party:read"]);
            // System setup is exempt. A person who really holds the permission may delegate it.
            yield* UnitOfWork.atomic(party.assignRole(system, assignment));
            yield* runFeature(define, custom).pipe(Effect.provide(request));
            expect(yield* party.permissionsOf(person)).toEqual(["billing:charge"]);
            yield* runFeature(assign, { ...assignment, personId: person.actor.id }).pipe(
              Effect.provide(request),
            );
          }),
      );
      it.effect(
        "permissions from another organisation never authorize delegation in this scope",
        () =>
          UnitOfWork.atomic(
            Effect.gen(function* () {
              const { party, admin, scoped, person, x, y, id } = yield* fixture();
              yield* party.assignRole(system, {
                personId: scoped.actor.id,
                roleKey: "member",
                organisationId: y.id,
              });
              yield* party.assignRole(system, {
                personId: admin.actor.id,
                roleKey: "member",
                organisationId: null,
              });
              const custom = {
                key: id,
                name: "Charge",
                permissions: ["billing:charge"],
                organisationId: x.id,
              };
              yield* party.defineRole(admin, custom);
              for (const roleKey of ["member", id]) {
                expect(
                  yield* Effect.flip(
                    party.assignRole(scoped, {
                      personId: person.actor.id,
                      roleKey,
                      organisationId: x.id,
                    }),
                  ),
                ).toBeInstanceOf(PartyDenied);
              }
              expect(
                yield* Effect.flip(party.defineRole(scoped, { ...custom, key: `${id}-new` })),
              ).toBeInstanceOf(PartyDenied);
              // An org permission cannot support a global role, even for a global admin.
              yield* party.assignRole(system, {
                personId: admin.actor.id,
                roleKey: "member",
                organisationId: null,
              });
              yield* party.revokeRole(admin, {
                personId: admin.actor.id,
                roleKey: "member",
                organisationId: null,
              });
              yield* party.assignRole(system, {
                personId: admin.actor.id,
                roleKey: "member",
                organisationId: y.id,
              });
              expect(
                yield* Effect.flip(party.defineRole(admin, { ...custom, organisationId: null })),
              ).toBeInstanceOf(PartyDenied);
              yield* party.assignRole(system, {
                personId: scoped.actor.id,
                roleKey: "member",
                organisationId: x.id,
              });
              yield* party.assignRole(scoped, {
                personId: person.actor.id,
                roleKey: id,
                organisationId: x.id,
              });
              yield* party.defineRole(scoped, { ...custom, key: `${id}-allowed` });
            }),
          ),
      );
      it.effect("denyAll refuses revoke and unrelate without changing either store", () =>
        Effect.gen(function* () {
          const { party, admin, person, x } = yield* UnitOfWork.atomic(fixture());
          const assignment = { personId: person.actor.id, roleKey: "reader", organisationId: x.id };
          const relationship = {
            from: { kind: "person", id: person.actor.id },
            to: { kind: "organisation", id: x.id },
            kind: "staff_of",
          } as const;
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              yield* party.assignRole(admin, assignment);
              yield* party.relate(admin, relationship);
            }),
          );
          const request = yield* as(admin);
          const denied = Layer.merge(request, Approval.denyAll);
          expect(
            (yield* Effect.flip(runFeature(revoke, assignment).pipe(Effect.provide(denied))))._tag,
          ).toBe("ApprovalDenied");
          expect(
            (yield* Effect.flip(runFeature(unrelate, relationship).pipe(Effect.provide(denied))))
              ._tag,
          ).toBe("ApprovalDenied");
          expect(yield* party.rolesOf(admin, person.actor.id)).toEqual([assignment]);
          expect(yield* party.isRelated(relationship)).toBe(true);
          yield* runFeature(revoke, assignment).pipe(Effect.provide(request));
          yield* runFeature(unrelate, relationship).pipe(Effect.provide(request));
          expect(yield* party.rolesOf(admin, person.actor.id)).toEqual([]);
          expect(yield* party.isRelated(relationship)).toBe(false);
        }),
      );
      it.effect("role lists and assignment reads hide other orgs and global custom roles", () =>
        Effect.gen(function* () {
          const { party, admin, scoped, person, x, y, id } = yield* UnitOfWork.atomic(fixture());
          const own = {
            key: `${id}-own`,
            name: "Own",
            permissions: ["party:read"],
            organisationId: x.id,
          };
          yield* UnitOfWork.atomic(
            Effect.gen(function* () {
              for (const role of [
                own,
                { ...own, key: `${id}-secret`, name: "Secret", organisationId: y.id },
                { ...own, key: `${id}-global`, organisationId: null },
              ]) {
                yield* party.defineRole(admin, role);
                yield* party.assignRole(admin, {
                  personId: person.actor.id,
                  roleKey: role.key,
                  organisationId: role.organisationId,
                });
              }
            }),
          );
          const request = yield* as(scoped);
          expect(yield* runFeature(list, {}).pipe(Effect.provide(request))).toEqual([
            ...Object.entries(options.builtInRoles).map(([key, role]) => ({
              key,
              ...role,
              builtIn: true,
              organisationId: null,
            })),
            { ...own, builtIn: false },
          ]);
          expect(
            yield* runFeature(assignments, { personId: person.actor.id }).pipe(
              Effect.provide(request),
            ),
          ).toEqual([{ personId: person.actor.id, roleKey: own.key, organisationId: x.id }]);
          const all = yield* party.listRoles(admin);
          expect(all.some((r) => r.key === `${id}-secret`)).toBe(true);
          expect(all.some((r) => r.key === `${id}-global`)).toBe(true);
        }),
      );
    },
  );
}
