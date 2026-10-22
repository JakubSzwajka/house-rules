import * as NodePlatform from "@effect/platform-node";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { Actor, type ActorId, UnitOfWork } from "@house-rules/domain";
import { Config, Effect, Schema } from "effect";
import { modulesLayer } from "../src/composition/modules.ts";
import { plugSockets } from "../src/composition/app-layer.ts";

class SeedRefused extends Schema.TaggedError<SeedRefused>()("SeedRefused", {
  message: Schema.String,
}) {}
const system = {
  kind: "system",
  reason: "development demo seed",
  startedBy: "script:seed",
} as const;
const accounts = [
  ["alice", "member"],
  ["bob", "partner"],
  ["carol", "org-admin"],
  ["dave", "member"],
  ["admin", "admin"],
] as const;

export const seed = Effect.fn("seed")(function* (nodeEnv: string) {
  if (nodeEnv === "production")
    return yield* new SeedRefused({ message: "Demo seeding is refused in production." });
  const identity = yield* Identity;
  const party = yield* Party;
  const issuer = yield* identity.passwordIssuer();
  if (!issuer)
    return yield* new SeedRefused({ message: "Demo seeding needs the passwords provider." });
  return yield* UnitOfWork.atomic(
    Effect.gen(function* () {
      const people = new Map<string, ActorId>();
      for (const [name, roleKey] of accounts) {
        const email = `${name}@example.test`;
        const account = yield* identity.accountByEmail(email).pipe(
          Effect.catchTag("PasswordAccountNotFound", () =>
            Effect.gen(function* () {
              const account = yield* identity.signUp({
                email,
                password: "house-rules-demo",
                displayName: name,
              });
              const person = yield* party.createPerson({ displayName: name });
              yield* identity.bind(
                { issuer: issuer.issuer, subject: account.accountId },
                person.id,
              );
              return { actorId: person.id };
            }),
          ),
        );
        people.set(name, account.actorId);
        if (name !== "carol")
          yield* party.assignRole(system, {
            personId: account.actorId,
            roleKey,
            organisationId: null,
          });
      }
      const idFor = (name: string) =>
        Effect.fromNullishOr(people.get(name)).pipe(
          Effect.mapError(() => new SeedRefused({ message: "Demo account was not created." })),
        );
      const adminId = yield* idFor("admin");
      const carolId = yield* idFor("carol");
      const admin = {
        kind: "person",
        actor: Actor.make({ id: adminId }),
        via: "script:seed",
      } as const;
      const org = yield* party.showOrganisation("acme").pipe(
        Effect.catchTag("PartyNotFound", () =>
          party.createOrganisation(
            {
              kind: "person",
              actor: Actor.make({ id: carolId }),
              via: "script:seed",
            },
            { id: "acme", name: "Acme" },
          ),
        ),
      );
      for (const name of ["carol", "dave"] as const)
        yield* party.relate(admin, {
          from: { kind: "person", id: yield* idFor(name) },
          to: { kind: "organisation", id: org.id },
          kind: "staff",
        });
      yield* party.assignRole(system, {
        personId: carolId,
        roleKey: "org-admin",
        organisationId: org.id,
      });
      return [...people.entries()];
    }),
  );
});
if (process.argv[1]?.endsWith("/seed.js")) {
  Effect.gen(function* () {
    const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
    yield* seed(nodeEnv);
    yield* Effect.log("Demo accounts ready: alice, bob, carol, dave, admin at @example.test.");
  }).pipe(Effect.provide(plugSockets(modulesLayer())), NodePlatform.NodeRuntime.runMain);
}
