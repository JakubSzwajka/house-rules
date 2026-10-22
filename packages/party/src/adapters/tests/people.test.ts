import { assert, it } from "@effect/vitest";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { Party, PartyStore, PermissionCatalogue } from "../../index.js";
import { fixtureTesting, partyOptionsTesting } from "./party-access-testing.js";
import { stores } from "./stores.js";

for (const store of stores) {
  const layer = Party.layer(partyOptionsTesting).pipe(
    Layer.provideMerge(store.layer),
    Layer.provide(
      Layer.succeed(PermissionCatalogue, {
        permissions: () => Effect.succeed(["party:admin", "party:read"]),
      }),
    ),
  );
  it.layer(layer)(`${store.name}: people privacy`, (it) => {
    const fixture = fixtureTesting();
    it.effect(
      "filters people, assignments and relations to administered orgs before returning facts",
      () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, scoped, person, admin, x, y } = yield* fixture();
            const facts = yield* PartyStore;
            const onlyB = ActorId.make(`${y.id}-member`);
            yield* party.createPerson({ id: onlyB, displayName: "Only B" });
            yield* party.relate(admin, {
              from: { kind: "person", id: onlyB },
              to: { kind: "organisation", id: y.id },
              kind: "staff",
            });
            const custom = yield* party.defineRole(admin, {
              key: `${y.id}-reader`,
              name: "Private B role",
              organisationId: y.id,
              permissions: ["party:read"],
            });
            yield* party.assignRole(admin, {
              personId: onlyB,
              roleKey: custom.key,
              organisationId: y.id,
            });
            for (const org of [x, y]) {
              yield* party.relate(admin, {
                from: { kind: "person", id: person.actor.id },
                to: { kind: "organisation", id: org.id },
                kind: "staff",
              });
              yield* party.assignRole(admin, {
                personId: person.actor.id,
                roleKey: "reader",
                organisationId: org.id,
              });
            }
            yield* party.assignRole(admin, {
              personId: person.actor.id,
              roleKey: "reader",
              organisationId: null,
            });
            yield* party.assignRole(admin, {
              personId: person.actor.id,
              roleKey: custom.key,
              organisationId: y.id,
            });
            const people = yield* party.listPeople(scoped);
            assert.deepStrictEqual(
              people.map((p) => p.id).sort(),
              [admin.actor.id, person.actor.id].sort(),
            );
            const member = people.find((p) => p.id === person.actor.id);
            assert.isDefined(member);
            assert.deepStrictEqual(member.assignments, [
              {
                roleKey: "reader",
                roleName: "Reader",
                organisationId: x.id,
                organisationName: x.name,
              },
            ]);
            assert.deepStrictEqual(member.organisations, [{ ...x, relation: "staff" }]);
            assert.deepStrictEqual(
              (yield* facts.scopedAssignments(person.actor.id, [x.id])).map(
                (a) => a.organisationId,
              ),
              [x.id],
            );
            assert.deepStrictEqual(yield* facts.relationsFor(person.actor.id, [x.id]), [
              { ...x, relation: "staff" },
            ]);
            const global = (yield* party.listPeople(admin)).find((p) => p.id === person.actor.id);
            assert.isDefined(global);
            assert.deepStrictEqual(
              global.assignments.map((a) => a.organisationId).sort(),
              [null, x.id, y.id, y.id].sort(),
            );
            assert.deepStrictEqual(global.organisations, [
              { ...x, relation: "staff" },
              { ...y, relation: "staff" },
            ]);
            assert.strictEqual(
              (yield* party.listPeople(person).pipe(Effect.flip))._tag,
              "PartyDenied",
            );
            const members = yield* party.listMembers(scoped, x.id);
            assert.deepStrictEqual(members.find((p) => p.id === person.actor.id)?.roles, [
              { roleKey: "reader", roleName: "Reader" },
            ]);
            assert.strictEqual(members.find((p) => p.id === person.actor.id)?.relation, "staff");
            assert.deepStrictEqual(yield* party.listMembers(admin, x.id), members);
            for (const [caller, org] of [
              [scoped, y.id],
              [scoped, "unknown"],
              [person, x.id],
              [person, "unknown"],
              [admin, "unknown"],
            ] as const) {
              const failure = yield* party.listMembers(caller, org).pipe(Effect.flip);
              assert.strictEqual(failure._tag, "PartyNotFound");
              assert.strictEqual(failure.kind, "not_found");
            }
            assert.deepStrictEqual(
              yield* party.myOrganisations(person),
              [x, y].map((org) => ({
                ...org,
                relation: "staff",
                roles: [
                  ...(org.id === y.id
                    ? [{ roleKey: custom.key, roleName: custom.name, permissions: ["party:read"] }]
                    : []),
                  { roleKey: "reader", roleName: "Reader", permissions: ["party:read"] },
                ],
              })),
            );
            assert.deepStrictEqual(yield* party.myOrganisations(scoped), [
              {
                ...x,
                relation: null,
                roles: [
                  {
                    roleKey: "admin",
                    roleName: "Admin",
                    permissions: ["party:admin", "party:read"],
                  },
                ],
              },
            ]);
          }),
        ),
    );
  });
}
