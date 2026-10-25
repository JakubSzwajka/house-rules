import { assert, it } from "@effect/vitest";
import { Approval, CurrentActor, May, runFeature } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { Context, Effect, Layer } from "effect";
import { Features } from "../../features/index.ts";
import { modulePlan, createApp } from "../app.ts";
import { builtInRoles, systemPermissions } from "../access.ts";
import { seedRoleTesting } from "./roles-testing.ts";
import { databaseTesting } from "./database.ts";

for (const storage of ["memory", "postgres"] as const) {
  it.live(
    `${storage}: organisations, invites and people enforce A/B privacy, delegation and approval`,
    () =>
      Effect.gen(function* () {
        const plan = modulePlan();
        const app = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createApp([], {
              modules: {
                ...plan,
                layer:
                  storage === "postgres"
                    ? plan.layer.pipe(Layer.provideMerge(databaseTesting))
                    : plan.layer,
              },
            }),
          ),
          (app) => Effect.promise(() => app.dispose()),
        );
        const context = yield* app.runtime.contextEffect;
        for (const id of ["a", "b", "member", "joiner"] as const)
          yield* seedRoleTesting(id).pipe(Effect.provideContext(context));
        yield* seedRoleTesting("global", "admin").pipe(Effect.provideContext(context));
        const may = yield* Party.may().pipe(Effect.provideContext(context));
        const as = (id: string) =>
          Context.merge(
            Context.add(context, CurrentActor, Actor.make({ id: ActorId.make(id) })),
            May.context(may, {
              features: Object.values(Features),
              system: systemPermissions,
              via: "web",
            }),
          );
        const party = Context.get(context, Party);
        const x = yield* runFeature(Features.createOrganisation, { id: "x", name: "X" }).pipe(
          Effect.provideContext(as("a")),
        );
        const y = yield* runFeature(Features.createOrganisation, { id: "y", name: "Y" }).pipe(
          Effect.provideContext(as("b")),
        );
        assert.deepStrictEqual(
          (yield* party.rolesOf(
            { kind: "person", actor: Actor.make({ id: ActorId.make("a") }), via: "test" },
            ActorId.make("a"),
          ))
            .filter((a) => a.roleKey === "org-admin")
            .map((a) => a.organisationId),
          [x.id],
        );
        const adminRoles = [
          {
            roleKey: "org-admin",
            roleName: "Organisation admin",
            permissions: [...builtInRoles["org-admin"].permissions],
          },
        ];
        for (const [id, org] of [
          ["a", x],
          ["b", y],
        ] as const)
          assert.deepStrictEqual(
            yield* runFeature(Features.myOrganisations, {}).pipe(Effect.provideContext(as(id))),
            [{ ...org, relation: "staff", roles: adminRoles }],
          );
        for (const feature of [Features.createInvitation, Features.listInvitations] as const) {
          const input = { organisationId: y.id, roleKey: null };
          assert.strictEqual(
            (yield* runFeature(feature, input).pipe(Effect.provideContext(as("a")), Effect.flip))
              ._tag,
            "PartyDenied",
          );
          assert.strictEqual(
            (yield* runFeature(feature, input).pipe(
              Effect.provideContext(as("member")),
              Effect.flip,
            ))._tag,
            "Forbidden",
          );
        }
        const invite = yield* runFeature(Features.createInvitation, {
          organisationId: x.id,
          roleKey: "org-admin",
        }).pipe(Effect.provideContext(as("a")));
        assert.strictEqual(
          (yield* runFeature(Features.createInvitation, {
            organisationId: x.id,
            roleKey: "admin",
          }).pipe(Effect.provideContext(as("a")), Effect.flip))._tag,
          "PartyDenied",
        );
        assert.strictEqual(
          (yield* runFeature(Features.listInvitations, { organisationId: x.id }).pipe(
            Effect.provideContext(as("a")),
          )).length,
          1,
        );
        const accepted = yield* runFeature(Features.acceptInvitation, { code: invite.code }).pipe(
          Effect.provideContext(as("joiner")),
        );
        assert.strictEqual(accepted.personId, "joiner");
        assert.strictEqual(
          (yield* runFeature(Features.acceptInvitation, { code: invite.code }).pipe(
            Effect.provideContext(as("b")),
            Effect.flip,
          ))._tag,
          "PartyNotFound",
        );
        const list = yield* runFeature(Features.listPeople, {}).pipe(
          Effect.provideContext(as("a")),
        );
        assert.deepStrictEqual(list.map((p) => p.id).sort(), ["a", "joiner"]);
        assert.deepStrictEqual(
          (yield* runFeature(Features.listPeople, {}).pipe(Effect.provideContext(as("b")))).map(
            (p) => p.id,
          ),
          ["b"],
        );
        assert.deepStrictEqual(
          list.flatMap((p) => p.assignments).map((a) => a.organisationId),
          [x.id, x.id],
        );
        assert.deepStrictEqual(
          list.flatMap((p) => p.organisations).map((o) => o.id),
          [x.id, x.id],
        );
        assert.deepStrictEqual(
          (yield* runFeature(Features.listMembers, { organisationId: x.id }).pipe(
            Effect.provideContext(as("a")),
          )).map((p) => ({ id: p.id, relation: p.relation, roles: p.roles })),
          ["a", "joiner"].map((id) => ({
            id: ActorId.make(id),
            relation: "staff",
            roles: [{ roleKey: "org-admin", roleName: "Organisation admin" }],
          })),
        );
        for (const [id, organisationId] of [
          ["a", y.id],
          ["a", "unknown"],
          ["member", x.id],
          ["member", "unknown"],
        ] as const)
          assert.strictEqual(
            (yield* runFeature(Features.listMembers, { organisationId }).pipe(
              Effect.provideContext(as(id)),
              Effect.flip,
            ))._tag,
            "PartyNotFound",
          );
        assert.strictEqual(
          (yield* runFeature(Features.listPeople, {}).pipe(
            Effect.provideContext(as("member")),
            Effect.flip,
          ))._tag,
          "Forbidden",
        );
        assert.strictEqual(
          (yield* runFeature(Features.listPeople, {}).pipe(Effect.provideContext(as("global"))))
            .length,
          5,
        );
        const fresh = yield* runFeature(Features.createInvitation, {
          organisationId: x.id,
          roleKey: null,
        }).pipe(Effect.provideContext(as("a")));
        assert.isTrue(Features.revokeInvitation.needsApproval);
        assert.isTrue(Features.removeMember.needsApproval);
        assert.strictEqual(
          (yield* runFeature(Features.revokeInvitation, { id: fresh.invitation.id }).pipe(
            Effect.provideContext(as("b")),
            Effect.provide(Approval.allowAll),
            Effect.flip,
          ))._tag,
          "PartyDenied",
        );
        yield* runFeature(Features.revokeInvitation, { id: fresh.invitation.id }).pipe(
          Effect.provideContext(as("a")),
          Effect.provide(Approval.allowAll),
        );
        assert.strictEqual(
          (yield* runFeature(Features.acceptInvitation, { code: fresh.code }).pipe(
            Effect.provideContext(as("member")),
            Effect.flip,
          ))._tag,
          "PartyNotFound",
        );
        const relation = {
          from: { kind: "person", id: "joiner" },
          to: { kind: "organisation", id: x.id },
          kind: "staff",
        } as const;
        assert.strictEqual(
          (yield* runFeature(Features.removeMember, relation).pipe(
            Effect.provideContext(as("b")),
            Effect.provide(Approval.allowAll),
            Effect.flip,
          ))._tag,
          "PartyDenied",
        );
        yield* runFeature(Features.removeMember, relation).pipe(
          Effect.provideContext(as("a")),
          Effect.provide(Approval.allowAll),
        );
        assert.isFalse(yield* party.isRelated(relation));
        assert.strictEqual(
          (yield* runFeature(Features.listInvitations, { organisationId: x.id }).pipe(
            Effect.provideContext(as("joiner")),
            Effect.flip,
          ))._tag,
          "Forbidden",
        );
        const joinerAccess = yield* party.myAccess({
          kind: "person",
          actor: Actor.make({ id: ActorId.make("joiner") }),
          via: "test",
        });
        assert.isTrue(
          joinerAccess.roles.some((r) => r.roleKey === "member" && r.organisationId === null),
        );
        assert.isFalse(joinerAccess.roles.some((r) => r.organisationId === x.id));
        const lastAdmin = {
          from: { kind: "person", id: "a" },
          to: { kind: "organisation", id: x.id },
          kind: "staff",
        } as const;
        assert.strictEqual(
          (yield* runFeature(Features.removeMember, lastAdmin).pipe(
            Effect.provideContext(as("global")),
            Effect.provide(Approval.allowAll),
            Effect.flip,
          ))._tag,
          "PartyLastAdmin",
        );
        yield* UnitOfWork.atomic(
          party.revokeRole(
            { kind: "person", actor: Actor.make({ id: ActorId.make("global") }), via: "test" },
            { personId: ActorId.make("member"), roleKey: "member", organisationId: null },
          ),
        ).pipe(Effect.provideContext(context));
        assert.strictEqual(
          (yield* runFeature(Features.createOrganisation, { id: "denied", name: "Denied" }).pipe(
            Effect.provideContext(as("member")),
            Effect.flip,
          ))._tag,
          "Forbidden",
        );
      }).pipe(Effect.scoped),
    30_000,
  );
}
