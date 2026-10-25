import { assert, it } from "@effect/vitest";
import { planLayer } from "@house-rules/application";
import { Actor } from "@house-rules/domain";
import { Party } from "@house-rules/party";
import { Context, Effect, Layer } from "effect";
import { modulePlan } from "../app.ts";
import { builtInRoles } from "../access.ts";
import { databaseTesting } from "./database.ts";
import { seed } from "../../../scripts/seed.ts";

for (const storage of ["memory", "postgres"] as const)
  it.live(
    `${storage}: seed is idempotent, creates scoped demo users and refuses production`,
    () =>
      Effect.gen(function* () {
        const services = planLayer(modulePlan());
        const context = yield* Layer.build(
          storage === "postgres" ? services.pipe(Layer.provide(databaseTesting)) : services,
        );
        const first = yield* seed("development").pipe(Effect.provideContext(context));
        const second = yield* seed("development").pipe(Effect.provideContext(context));
        assert.deepStrictEqual(second, first);
        assert.strictEqual(
          (yield* seed("production").pipe(Effect.provideContext(context), Effect.flip))._tag,
          "SeedRefused",
        );
        const carolEntry = first.find(([name]) => name === "carol");
        assert.isDefined(carolEntry);
        const carol = carolEntry[1];
        const party = Context.get(context, Party);
        assert.deepStrictEqual(
          yield* party.myOrganisations({
            kind: "person",
            actor: Actor.make({ id: carol }),
            via: "test",
          }),
          [
            {
              id: "acme",
              name: "Acme",
              relation: "staff",
              roles: [
                {
                  roleKey: "org-admin",
                  roleName: "Organisation admin",
                  permissions: [...builtInRoles["org-admin"].permissions],
                },
              ],
            },
          ],
        );
      }).pipe(Effect.scoped),
    30_000,
  );
