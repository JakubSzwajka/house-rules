import { assert, it } from "@effect/vitest";
import { runEntry, May, Approval, StepTrace } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Identity } from "@house-rules/identity";
import { Party, PersonNotFound } from "@house-rules/party";
import { Context, Effect, Layer, Option } from "effect";
import { Entries, systemPermissions } from "../entries.ts";
import { mountMemoryModules, mountPostgresModules, plugSockets } from "../index.ts";
import { databaseTesting } from "./database.ts";

for (const backend of ["memory", "postgres"] as const)
  it.effect(
    `${backend}: first sign-in person and login binding share one entry unit`,
    () =>
      Effect.gen(function* () {
        const modules =
          backend === "memory" ? mountMemoryModules() : mountPostgresModules(databaseTesting);
        const created: ActorId[] = [];
        const observed = Layer.effect(
          Party,
          Effect.gen(function* () {
            const party = yield* Party;
            return {
              ...party,
              createPerson: (input) =>
                party.createPerson(input).pipe(
                  Effect.tap((person) =>
                    Effect.sync(() => {
                      created.push(person.id);
                    }),
                  ),
                ),
            };
          }),
        ).pipe(Layer.provide(modules));
        const ctx = yield* Layer.build(plugSockets(Layer.merge(modules, observed)));
        const identity = Context.get(ctx, Identity);
        const party = Context.get(ctx, Party);
        const original = ActorId.make("original");
        const login = { issuer: "https://login.invalid", subject: "existing" };
        yield* UnitOfWork.atomic(identity.bind(login, original)).pipe(Effect.provideContext(ctx));
        const permissions = May.context(May.system([Entries.firstSignIn]), {
          system: systemPermissions,
          via: "hook:new-login",
        });
        const run = (subject: string) =>
          runEntry(Entries.firstSignIn, { ...login, subject, displayName: "New person" }).pipe(
            Effect.provideContext(Context.merge(ctx, permissions)),
            Effect.provide(Approval.allowAll),
          );
        const failure = yield* run(login.subject).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "BindingTaken");
        assert.strictEqual(created.length, 1);
        const failedPerson = created[0];
        assert.isDefined(failedPerson);
        if (failedPerson === undefined) return;
        assert.instanceOf(
          yield* party.get(Actor.make({ id: original }), failedPerson).pipe(Effect.flip),
          PersonNotFound,
        );
        assert.deepStrictEqual(yield* identity.resolve(login), Option.some(original));
        const id = yield* run("fresh");
        assert.strictEqual((yield* party.me(Actor.make({ id }))).id, id);
        const resolved = yield* identity.resolve({ ...login, subject: "fresh" });
        assert.strictEqual(resolved._tag, "Some");
        if (resolved._tag === "Some") assert.strictEqual(resolved.value, id);
        const trace = yield* Context.get(ctx, StepTrace).read(null);
        assert.isTrue(trace.steps.every((s) => s.caller === "system" && s.reason === "new login"));
      }).pipe(Effect.scoped),
    30_000,
  );
