import { assert, it } from "@effect/vitest";
import { Approval, CurrentActor, May, runFeature, withRequestId } from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { Clock, Context, Effect, Layer } from "effect";
import { Features } from "../../features/index.ts";
import { modulePlan, createApp } from "../index.ts";
import { systemPermissions } from "../roles.ts";
import { seedRoleTesting } from "./roles-testing.ts";
import { databaseTesting } from "./database.ts";
for (const storage of ["memory", "postgres"] as const) {
  it.live(
    `${storage}: profile, catalogue and audit reads preserve A/B privacy and admin gates`,
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
        yield* seedRoleTesting("alice", "admin").pipe(Effect.provideContext(context));
        yield* seedRoleTesting("bob").pipe(Effect.provideContext(context));
        yield* seedRoleTesting("carol", "admin").pipe(Effect.provideContext(context));
        const party = Context.get(context, Party);
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
        const startedAt = yield* Clock.currentTimeMillis;
        for (const id of ["alice", "bob"] as const) {
          const profile = yield* runFeature(Features.myProfile, {}).pipe(
            withRequestId(`profile-${id}`),
            Effect.provideContext(as(id)),
          );
          assert.strictEqual(profile.person.id, ActorId.make(id));
          assert.deepStrictEqual(
            profile.access.roles.map((role) => role.personId),
            [ActorId.make(id)],
          );
          assert.strictEqual(profile.access.permissions.includes("party:admin"), id === "alice");
          const catalogue = yield* runFeature(Features.listPermissions, {}).pipe(
            Effect.provideContext(as(id)),
          );
          assert.include(catalogue, "audit:read");
          assert.deepStrictEqual(catalogue, profile.access.catalogue);
        }
        const denied = yield* runFeature(Features.recentAudit, {}).pipe(
          Effect.provideContext(as("bob")),
          Effect.flip,
        );
        assert.strictEqual(denied._tag, "Forbidden");
        const alice = yield* runFeature(Features.recentAudit, {}).pipe(
          Effect.provideContext(as("alice")),
        );
        assert.isTrue(alice.some((row) => row.requestId === "profile-alice"));
        assert.isTrue(alice.some((row) => row.requestId === "profile-bob"));
        const publicEntry = alice.find((row) => row.requestId === "profile-bob");
        assert.isDefined(publicEntry);
        assert.isTrue(publicEntry.at >= startedAt);
        assert.isTrue(publicEntry.at <= (yield* Clock.currentTimeMillis));
        assert.strictEqual(publicEntry.who, "bob");
        const carol = yield* runFeature(Features.recentAudit, {}).pipe(
          Effect.provideContext(as("carol")),
        );
        assert.isTrue(carol.some((row) => row.requestId === "profile-alice"));
        const mine = yield* runFeature(Features.myActivity, {}).pipe(
          Effect.provideContext(as("bob")),
        );
        assert.isTrue(mine.some((row) => row.requestId === "profile-bob"));
        assert.isFalse(mine.some((row) => row.requestId === "profile-alice"));
        assert.isTrue(mine.every((row) => row.who === "bob"));
        assert.deepStrictEqual(
          mine.find((row) => row.requestId === "profile-bob"),
          publicEntry,
        );
        yield* runFeature(Features.defineRole, {
          key: "temporary",
          name: "Temporary",
          permissions: ["party:read"],
          organisationId: null,
        }).pipe(Effect.provideContext(as("alice")));
        yield* runFeature(Features.deleteRole, { key: "temporary" }).pipe(
          Effect.provideContext(as("alice")),
          Effect.provide(Approval.allowAll),
        );
        assert.isFalse(
          (yield* party.listRoles({
            kind: "person",
            actor: Actor.make({ id: ActorId.make("alice") }),
            via: "test",
          })).some((role) => role.key === "temporary"),
        );
      }).pipe(Effect.scoped),
    30_000,
  );
}
