import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Party, PartyMount, PersonInputInvalid } from "../../index.js";
import { principalsTesting } from "./principals-testing.js";
import { stores } from "./stores.js";

const { features, request, create, input, actor } = principalsTesting;
for (const { name, layer: storage } of stores) {
  const world = Runtime.layer({ mounts: [PartyMount], features, ways: [] }).pipe(
    Layer.provideMerge(Party.layer({ builtInRoles: {} }).pipe(Layer.provideMerge(storage))),
    Layer.provideMerge(StepTrace.layer()),
    Layer.provideMerge(request),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Principal defaults on ${name}`,
    (it) => {
      it.effect("has no app pattern or reserved words, but requires 1 to 120 characters", () =>
        Effect.gen(function* () {
          for (const handle of ["me", "Name_With/symbols", "a".repeat(120)]) {
            const created = yield* runFeature(create, {
              ...input(handle),
              displayName: "Default principal",
              createdBy: null,
            });
            expect(created.principal.handle).toBe(handle);
            expect(created.principal.createdBy).toBeNull();
          }
          for (const handle of ["", "a".repeat(121)]) {
            expect(
              yield* Effect.flip(
                runFeature(create, { ...input(handle), displayName: "Invalid handle" }),
              ),
            ).toBeInstanceOf(PersonInputInvalid);
          }
        }),
      );
      if (name === "postgres") {
        it.effect("publishes principals and assignments for app read models", () =>
          Effect.gen(function* () {
            const created = yield* runFeature(create, input("published"));
            const client = yield* Effect.serviceOption(SqlClient);
            if (Option.isNone(client)) return yield* Effect.die("Postgres client missing");
            const sql = client.value;
            const rows =
              yield* sql`select id, kind, handle, created_by, disabled_at from party_principals_read where id = ${created.principal.id}`;
            expect(rows).toEqual([
              {
                id: created.principal.id,
                kind: "agent",
                handle: "published",
                created_by: actor.id,
                disabled_at: null,
              },
            ]);
            expect(
              yield* sql`select person_id, role_key, organisation_id from party_assignments_read where person_id = ${created.principal.id}`,
            ).toEqual([]);
          }),
        );
      }
    },
  );
}
