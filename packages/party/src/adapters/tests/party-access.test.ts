import { expect, layer } from "@effect/vitest";
import { type Permission, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  Party,
  PartyConflict,
  PartyDenied,
  PartyInputInvalid,
  PartyOperations,
  PartyStore,
} from "../../index.js";
import {
  fixtureTesting,
  partyOptionsTesting as options,
  systemTesting as system,
} from "./party-access-testing.js";
import { stores } from "./stores.js";
import { PermissionCatalogue } from "@house-rules/application";

for (const { name, layer: storeLayer } of stores) {
  let permissions: readonly Permission[] = ["party:admin", "party:read"];
  const catalogue = Layer.succeed(PermissionCatalogue, {
    permissions: () => Effect.sync(() => permissions),
  });
  const world = Party.layer(options).pipe(Layer.provideMerge(storeLayer), Layer.provide(catalogue));
  const fixture = fixtureTesting();
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Party access on ${name}`,
    (it) => {
      it.effect("org admins manage only their own org, never global or another org roles", () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, id, admin, scoped, person, x, y } = yield* fixture();
            const role = {
              key: id,
              name: "Custom",
              permissions: ["party:read"],
              organisationId: x.id,
            };
            yield* party.defineRole(scoped, role);
            yield* party.assignRole(scoped, {
              personId: person.actor.id,
              roleKey: id,
              organisationId: x.id,
            });
            for (const organisationId of [y.id, null]) {
              expect(
                yield* Effect.flip(
                  party.defineRole(scoped, {
                    ...role,
                    key: `${id}-${organisationId}`,
                    organisationId,
                  }),
                ),
              ).toBeInstanceOf(PartyDenied);
              expect(
                yield* Effect.flip(
                  party.assignRole(scoped, {
                    personId: person.actor.id,
                    roleKey: "reader",
                    organisationId,
                  }),
                ),
              ).toBeInstanceOf(PartyDenied);
              expect(
                yield* Effect.flip(
                  party.revokeRole(scoped, {
                    personId: person.actor.id,
                    roleKey: "reader",
                    organisationId,
                  }),
                ),
              ).toBeInstanceOf(PartyDenied);
            }
            yield* party.defineRole(admin, { ...role, key: `${id}-other`, organisationId: y.id });
            expect(yield* Effect.flip(party.deleteRole(scoped, `${id}-other`))).toBeInstanceOf(
              PartyDenied,
            );
            expect(
              yield* Effect.flip(party.defineRole(scoped, { ...role, key: `${id}-other` })),
            ).toBeInstanceOf(PartyDenied);
            yield* party.deleteRole(scoped, id);
          }),
        ),
      );
      it.effect("built-in role keys cannot be changed or deleted", () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, admin } = yield* fixture();
            expect(
              yield* Effect.flip(
                party.defineRole(admin, {
                  key: "reader",
                  name: "Hijack",
                  permissions: [],
                  organisationId: null,
                }),
              ),
            ).toBeInstanceOf(PartyConflict);
            expect(yield* Effect.flip(party.deleteRole(admin, "reader"))).toBeInstanceOf(
              PartyConflict,
            );
            expect(
              (yield* party.listRoles(admin)).filter((r) => r.builtIn).map((r) => r.key),
            ).toEqual(["admin", "reader"]);
          }),
        ),
      );
      it.effect("rejects unknown and malformed permissions", () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, admin, id } = yield* fixture();
            for (const permission of ["party:invented", "not a permission", "a:b:c"]) {
              expect(
                yield* Effect.flip(
                  party.defineRole(admin, {
                    key: id,
                    name: "Bad",
                    permissions: [permission],
                    organisationId: null,
                  }),
                ),
              ).toBeInstanceOf(PartyInputInvalid);
            }
          }),
        ),
      );
      it.effect(
        "May unions all contexts, drops stale permissions, and sees revocation next call",
        () =>
          Effect.gen(function* () {
            const { party, admin, person, x, y, id } = yield* UnitOfWork.atomic(fixture());
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* party.defineRole(admin, {
                  key: id,
                  name: "Custom",
                  permissions: ["party:read"],
                  organisationId: null,
                });
                yield* party.assignRole(admin, {
                  personId: person.actor.id,
                  roleKey: id,
                  organisationId: x.id,
                });
                yield* party.assignRole(admin, {
                  personId: person.actor.id,
                  roleKey: "reader",
                  organisationId: y.id,
                });
                const store = yield* PartyStore;
                yield* store.putRole({
                  key: `${id}-stale`,
                  name: "Stale",
                  permissions: ["gone:read"],
                  organisationId: null,
                  builtIn: false,
                });
                yield* party.assignRole(system, {
                  personId: person.actor.id,
                  roleKey: `${id}-stale`,
                  organisationId: null,
                });
              }),
            );
            const may = yield* Party.may();
            expect(yield* may.permissionsOf(person)).toEqual(["party:read"]);
            expect(yield* may.permissionsOf({ ...person, via: "mcp" })).toEqual(["party:read"]);
            permissions = ["party:admin"];
            expect(
              yield* may.permissionsOf(person).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    permissions = ["party:admin", "party:read"];
                  }),
                ),
              ),
            ).toEqual([]);
            yield* UnitOfWork.atomic(
              party.revokeRole(admin, {
                personId: person.actor.id,
                roleKey: id,
                organisationId: x.id,
              }),
            );
            expect(yield* may.permissionsOf(person)).toEqual(["party:read"]);
            yield* UnitOfWork.atomic(
              party.revokeRole(admin, {
                personId: person.actor.id,
                roleKey: "reader",
                organisationId: y.id,
              }),
            );
            expect(yield* may.permissionsOf(person)).toEqual([]);
          }),
      );
      it.effect("trusted system assignment works but an ordinary person cannot assign", () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, person } = yield* fixture();
            const assignment = {
              personId: person.actor.id,
              roleKey: "reader",
              organisationId: null,
            };
            expect(yield* Effect.flip(party.assignRole(person, assignment))).toBeInstanceOf(
              PartyDenied,
            );
            yield* party.assignRole(system, assignment);
            expect(yield* party.rolesOf(person, person.actor.id)).toEqual([assignment]);
            expect(yield* Effect.flip(party.revokeRole(system, assignment))).toBeInstanceOf(
              PartyDenied,
            );
          }),
        ),
      );
      it.effect("relation checks stay directional and scoped admins cannot link another org", () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, person, scoped, x, y } = yield* fixture();
            const relationship = {
              from: { kind: "person", id: person.actor.id },
              to: { kind: "organisation", id: x.id },
              kind: "staff_of",
            } as const;
            yield* party.relate(scoped, relationship);
            expect(yield* party.isRelated(relationship)).toBe(true);
            expect(
              yield* Effect.flip(
                party.relate(scoped, { ...relationship, to: { kind: "organisation", id: y.id } }),
              ),
            ).toBeInstanceOf(PartyDenied);
            yield* party.unrelate(scoped, relationship);
            expect(yield* party.isRelated(relationship)).toBe(false);
            expect(yield* party.showOrganisation(x.id)).toEqual(x);
          }),
        ),
      );
      it.effect("management and read descriptors declare permissions and destructive flags", () =>
        Effect.sync(() => {
          for (const operation of [
            PartyOperations.relate,
            PartyOperations.unrelate,
            PartyOperations.defineRole,
            PartyOperations.deleteRole,
            PartyOperations.assignRole,
            PartyOperations.revokeRole,
          ]) {
            expect(PartyOperations.createOrganisation.permission).toBe("party:create-organisation");
            expect(operation.permission).toBe("party:admin");
            expect(operation.transactional).toBe(true);
          }
          for (const operation of [
            PartyOperations.showOrganisation,
            PartyOperations.isRelated,
            PartyOperations.listRoles,
            PartyOperations.rolesOf,
          ]) {
            expect(operation.permission).toBe("party:read");
            expect(operation.readOnly).toBe(true);
          }
          expect(PartyOperations.deleteRole.needsApproval).toBe(true);
          expect(PartyOperations.deleteRole.destructive).toBe(true);
          expect(PartyOperations.revokeRole.destructive).toBe(true);
          expect(PartyOperations.revokeRole.needsApproval).toBe(true);
          expect(PartyOperations.unrelate.destructive).toBe(true);
          expect(PartyOperations.unrelate.needsApproval).toBe(true);
        }),
      );
    },
  );
}
