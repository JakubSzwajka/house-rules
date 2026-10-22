import { assert, it } from "@effect/vitest";
import { Approval, CurrentActor, May, runFeature } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { Context, Effect, Layer } from "effect";
import { Features } from "../../features/index.ts";
import { MyStuff } from "../../read-models/my-bookings/index.ts";
import { modulePlan, createApp } from "../index.ts";
import { systemPermissions } from "../roles.ts";
import { seedRoleTesting } from "./roles-testing.ts";
import { databaseTesting } from "./database.ts";

for (const storage of ["memory", "postgres"] as const) {
  it.live(
    `${storage}: org bookings check live relations and scoped admin in the module`,
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
        for (const id of ["owner", "staff", "beta", "outsider", "acme-admin", "beta-admin"])
          yield* seedRoleTesting(id).pipe(Effect.provideContext(context));
        yield* seedRoleTesting("global", "admin").pipe(Effect.provideContext(context));
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
        for (const [id, organisationId] of [
          ["acme-admin", "acme"],
          ["beta-admin", "beta"],
        ] as const)
          yield* runFeature(Features.createOrganisation, {
            id: organisationId,
            name: organisationId,
          }).pipe(Effect.provideContext(as(id)));
        const global = {
          kind: "person",
          actor: Actor.make({ id: ActorId.make("global") }),
          via: "test",
        } as const;
        const relation = (id: string, org: string) =>
          ({
            from: { kind: "person", id },
            to: { kind: "organisation", id: org },
            kind: "staff",
          }) as const;
        yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            for (const id of ["owner", "staff"]) yield* party.relate(global, relation(id, "acme"));
            yield* party.relate(global, relation("beta", "beta"));
          }),
        ).pipe(Effect.provideContext(context));
        for (const [id, organisationId] of [
          ["acme-1", "acme"],
          ["acme-2", "acme"],
          ["personal", null],
        ] as const)
          yield* runFeature(Features.makeBooking, {
            id,
            guestName: id,
            organisationId,
            paymentId: `pay-${id}`,
            amount: 100,
          }).pipe(Effect.provideContext(as("owner")));
        for (const id of ["staff", "acme-admin"])
          assert.strictEqual(
            (yield* runFeature(Features.showBooking, { id: "acme-1" }).pipe(
              Effect.provideContext(as(id)),
            )).id,
            "acme-1",
          );
        for (const id of ["beta", "outsider", "beta-admin"]) {
          assert.strictEqual(
            (yield* runFeature(Features.showBooking, { id: "acme-1" }).pipe(
              Effect.provideContext(as(id)),
              Effect.flip,
            ))._tag,
            "BookingNotFound",
          );
          assert.strictEqual(
            (yield* runFeature(Features.makeBooking, {
              id: `refused-${id}`,
              organisationId: "acme",
              guestName: id,
              paymentId: `refused-pay-${id}`,
              amount: 100,
            }).pipe(Effect.provideContext(as(id)), Effect.flip))._tag,
            "BookingOrganisationDenied",
          );
        }
        for (const id of ["staff", "beta-admin"])
          assert.strictEqual(
            (yield* runFeature(Features.cancelBooking, { id: "acme-1" }).pipe(
              Effect.provideContext(as(id)),
              Effect.provide(Approval.allowAll),
              Effect.flip,
            ))._tag,
            "BookingNotFound",
          );
        if (storage === "postgres") {
          // Call the read service directly: no feature handler can filter these rows afterwards.
          const read = Context.get(context, MyStuff);
          for (const id of ["staff", "acme-admin", "beta", "outsider"])
            assert.deepStrictEqual(
              (yield* read.myBookings(Actor.make({ id: ActorId.make(id) }))).map((b) => b.id),
              id === "staff" || id === "acme-admin" ? ["acme-1", "acme-2"] : [],
            );
          assert.deepStrictEqual(
            (yield* read.myBookings(Actor.make({ id: ActorId.make("owner") }))).map((b) => b.id),
            ["acme-1", "acme-2", "personal"],
          );
        }
        yield* runFeature(Features.removeMember, relation("staff", "acme")).pipe(
          Effect.provideContext(as("acme-admin")),
          Effect.provide(Approval.allowAll),
        );
        assert.strictEqual(
          (yield* runFeature(Features.showBooking, { id: "acme-1" }).pipe(
            Effect.provideContext(as("staff")),
            Effect.flip,
          ))._tag,
          "BookingNotFound",
        );
        if (storage === "postgres")
          assert.deepStrictEqual(
            yield* Context.get(context, MyStuff).myBookings(
              Actor.make({ id: ActorId.make("staff") }),
            ),
            [],
          );
        assert.strictEqual(
          (yield* runFeature(Features.cancelBooking, { id: "acme-1" }).pipe(
            Effect.provideContext(as("acme-admin")),
            Effect.provide(Approval.allowAll),
          )).status,
          "cancelled",
        );
        assert.strictEqual(
          (yield* runFeature(Features.cancelBooking, { id: "acme-2" }).pipe(
            Effect.provideContext(as("owner")),
            Effect.provide(Approval.allowAll),
          )).status,
          "cancelled",
        );
      }).pipe(Effect.scoped),
    30_000,
  );
}
