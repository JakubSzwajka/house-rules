import { assert, it } from "@effect/vitest";
import { Approval, call, CurrentActor, May, runFeature } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { Context, Effect, Layer } from "effect";
import { createApp, modulePlan } from "../composition/app.ts";
import { Features } from "../features/index.ts";
import { ReadModels } from "../read-models/index.ts";
import { resourceOf } from "../composition/sign-in.ts";
import { databaseTesting } from "../composition/tests/database.ts";
import { seedRoleTesting } from "../composition/tests/roles-testing.ts";
import { webWay } from "../ways-in/web/way.ts";
import { mcpWay } from "../ways-in/mcp/way.ts";

for (const backend of ["memory", "postgres"] as const)
  it.live(
    `${backend}: roles grant and revoke access, MCP is the user, and org admins stay scoped`,
    () =>
      Effect.gen(function* () {
        if (mcpWay.protocol !== "mcp") return assert.fail("Expected MCP");
        const mcp = mcpWay;
        const actor = (id: string) => Actor.make({ id: ActorId.make(id) });
        const who = {
          resolve: (incoming: { headers: Headers }) =>
            Effect.succeed(actor(incoming.headers.get("actor") ?? "reader")),
        };
        const plan = modulePlan();
        const app = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createApp(
              [
                { ...webWay, who },
                {
                  ...mcp,
                  who,
                  resource: resourceOf("https://booking.example", "https://issuer.invalid"),
                },
              ],
              {
                modules: {
                  ...plan,
                  layer:
                    backend === "memory"
                      ? plan.layer
                      : plan.layer.pipe(Layer.provideMerge(databaseTesting)),
                },
              },
            ),
          ),
          (app) => Effect.promise(() => app.dispose()),
        );
        const context = yield* app.runtime.contextEffect;
        const party = Context.get(context, Party);
        yield* seedRoleTesting("admin", "admin").pipe(Effect.provideContext(context));
        yield* seedRoleTesting("member").pipe(Effect.provideContext(context));
        const admin = { kind: "person", actor: actor("admin"), via: "test" } as const;
        yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            yield* party.createPerson({ id: ActorId.make("reader"), displayName: "Reader" });
            yield* party.createOrganisation(admin, { id: "one", name: "One" });
            yield* party.createOrganisation(admin, { id: "two", name: "Two" });
          }),
        ).pipe(Effect.provideContext(context));
        yield* seedRoleTesting("org-admin", "admin", "one").pipe(Effect.provideContext(context));
        const incoming = (id: string) => ({
          headers: new Headers({ actor: id }),
          url: "https://booking.example",
        });
        const refused = yield* Effect.promise(() =>
          call(app, Features.listRoles, {}, incoming("reader"), { way: "web" }),
        );
        assert.isFalse(refused.ok);
        if (!refused.ok) assert.strictEqual(refused.error?._tag, "Forbidden");
        const defined = yield* Effect.promise(() =>
          call(
            app,
            Features.defineRole,
            {
              key: "reader",
              name: "Reader",
              permissions: ["party:read"],
              organisationId: null,
            },
            incoming("admin"),
            { way: "web" },
          ),
        );
        assert.isTrue(defined.ok);
        const assignment = {
          personId: ActorId.make("reader"),
          roleKey: "reader",
          organisationId: null,
        };
        assert.isTrue(
          (yield* Effect.promise(() =>
            call(app, Features.assignRole, assignment, incoming("admin"), { way: "web" }),
          )).ok,
        );
        assert.isTrue(
          (yield* Effect.promise(() =>
            call(app, Features.listRoles, {}, incoming("reader"), { way: "web" }),
          )).ok,
        );
        yield* runFeature(Features.revokeRole, assignment).pipe(
          Effect.provideContext(context),
          Effect.provideContext(
            May.context(yield* app.may.pipe(Effect.provideContext(context)), {
              features: [Features.revokeRole],
              system: [],
              via: "test",
            }),
          ),
          Effect.provideService(CurrentActor, admin.actor),
          Effect.provide(Approval.allowAll),
        );
        const revoked = yield* Effect.promise(() =>
          call(app, Features.listRoles, {}, incoming("reader"), { way: "web" }),
        );
        assert.isFalse(revoked.ok);
        if (!revoked.ok) assert.strictEqual(revoked.error?._tag, "Forbidden");
        const otherOrg = yield* Effect.promise(() =>
          call(
            app,
            Features.assignRole,
            {
              ...assignment,
              roleKey: "member",
              organisationId: "two",
            },
            incoming("org-admin"),
            { way: "web" },
          ),
        );
        assert.isFalse(otherOrg.ok);
        if (!otherOrg.ok) assert.strictEqual(otherOrg.error?._tag, "PartyDenied");
        assert.isTrue(
          (yield* Effect.promise(() =>
            call(
              app,
              Features.makeBooking,
              {
                id: "member-booking",
                guestName: "Member",
                paymentId: "payment",
                amount: 10,
              },
              incoming("member"),
              { way: "web" },
            ),
          )).ok,
        );
        assert.isTrue(
          (yield* Effect.promise(() =>
            call(app, ReadModels.showBooking, { id: "member-booking" }, incoming("member"), {
              way: "mcp",
            }),
          )).ok,
        );
        for (const feature of [
          Features.cancelBooking,
          Features.defineRole,
          Features.listRoles,
          Features.assignRole,
          Features.revokeRole,
        ])
          assert.isFalse(mcpWay.features.some((exposed) => String(exposed.name) === feature.name));
        // The example admin holds the permissions it delegates, not only party:admin.
        for (const roleKey of ["member", "partner"]) {
          assert.isTrue(
            (yield* Effect.promise(() =>
              call(app, Features.assignRole, { ...assignment, roleKey }, incoming("admin"), {
                way: "web",
              }),
            )).ok,
          );
        }
        const cancel = yield* Effect.promise(() =>
          call(app, Features.cancelBooking, { id: "member-booking" }, incoming("member"), {
            way: "mcp",
          }),
        );
        assert.isFalse(cancel.ok);
        if (!cancel.ok) assert.strictEqual(cancel.error?._tag, "CallInvalid");
      }).pipe(Effect.scoped),
    30_000,
  );
