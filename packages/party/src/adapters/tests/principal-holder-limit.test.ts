import { expect, layer } from "@effect/vitest";
import {
  Approval,
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Party, PartyMount, PartyOperations, PartyStore, PersonStore } from "../../index.js";
import { principalsTesting } from "./principals-testing.js";
import { stores } from "./stores.js";

const holders = defineFeature("limit_holders", {
  ...PartyOperations.holdersOf,
  permission: null,
  flags: { readOnly: true },
  edges: [PartyOperations.holdersOf],
  handler: (input, { call }) => call(PartyOperations.holdersOf, input),
});
const systemHolders = defineFeature("limit_system_holders", {
  ...PartyOperations.holdersOf,
  permission: null,
  flags: { readOnly: true },
  start: { kind: "system", reason: "Find process owner", startedBy: "tests" },
  edges: [PartyOperations.holdersOf],
  handler: (input, { call }) => call(PartyOperations.holdersOf, input),
});
const features = [...principalsTesting.features, holders, systemHolders];
const system = { kind: "system", reason: "Seed assignments", startedBy: "tests" } as const;

for (const { name, layer: storage } of stores) {
  const world = Runtime.layer({ mounts: [PartyMount], features, ways: [] }).pipe(
    Layer.provideMerge(
      Party.layer({
        builtInRoles: {
          owner: { name: "Owner", permissions: ["party:read"] },
          exact: { name: "Exact limit", permissions: ["party:read"] },
        },
      }).pipe(Layer.provideMerge(storage)),
    ),
    Layer.provideMerge(StepTrace.layer()),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CurrentActor, principalsTesting.actor),
        Approval.allowAll,
        Layer.succeedContext(
          May.context(May.fixed(["party:read"]), {
            features,
            system: ["party:read"],
            via: "test",
          }),
        ),
      ),
    ),
  );

  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Default holder limit on ${name}`,
    (test) => {
      test.effect("defaults to 1000 ids and flags only overflow", () =>
        Effect.gen(function* () {
          const people = Array.from({ length: 1001 }, (_, n) => {
            const id = `default-holder-${String(n).padStart(4, "0")}`;
            return { id, display_name: id, kind: "person", handle: id, created_by: null };
          });
          const sql = yield* Effect.serviceOption(SqlClient);
          if (sql._tag === "Some") {
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* sql.value`insert into party_person ${sql.value.insert(people)}`;
                yield* sql.value`insert into party_assignment ${sql.value.insert([
                  ...people.map(({ id }) => ({
                    person_id: id,
                    role_key: "owner",
                    organisation_id: null,
                  })),
                  ...people.slice(0, 1000).map(({ id }) => ({
                    person_id: id,
                    role_key: "exact",
                    organisation_id: null,
                  })),
                ])}`;
              }),
            );
          } else {
            yield* UnitOfWork.atomic(
              Effect.gen(function* () {
                const persons = yield* PersonStore;
                const assignments = yield* PartyStore;
                yield* Effect.forEach(
                  people,
                  ({ id }) =>
                    persons.insertPrincipal({
                      id: ActorId.make(id),
                      displayName: id,
                      createdAt: 0,
                      kind: "person",
                      handle: id,
                      createdBy: null,
                      disabledAt: null,
                    }),
                  { concurrency: 32 },
                );
                yield* Effect.forEach(
                  people,
                  ({ id }) =>
                    assignments.assign({
                      personId: ActorId.make(id),
                      roleKey: "owner",
                      organisationId: null,
                    }),
                  { concurrency: 32 },
                );
                yield* Effect.forEach(
                  people.slice(0, 1000),
                  ({ id }) =>
                    assignments.assign({
                      personId: ActorId.make(id),
                      roleKey: "exact",
                      organisationId: null,
                    }),
                  { concurrency: 32 },
                );
              }),
            );
          }
          for (const feature of [holders, systemHolders]) {
            const result = yield* runFeature(feature, { role: "owner" });
            expect(result.ids).toHaveLength(1000);
            expect(result.ids[0]).toBe("default-holder-0000");
            expect(result.ids[999]).toBe("default-holder-0999");
            expect(result.truncated).toBe(true);
            expect(yield* runFeature(feature, { role: "exact" })).toEqual({
              ids: people.slice(0, 1000).map(({ id }) => id),
              truncated: false,
            });
          }
        }),
      );
    },
  );
}
