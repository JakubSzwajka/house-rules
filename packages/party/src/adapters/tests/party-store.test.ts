import { expect, layer } from "@effect/vitest";
import { ActorId, NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { PartyStore, PersonStore, type Relationship } from "../../index.js";
import { stores } from "./stores.js";

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
for (const { name, layer: world } of stores) {
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `PartyStore on ${name}`,
    (it) => {
      const personId = ActorId.make("store-person");
      const org = { id: "store-org", name: "Organisation" };
      const role = {
        key: "store-role",
        name: "Staff",
        permissions: ["party:read"],
        organisationId: org.id,
        builtIn: false,
      };
      const assignment = { personId, roleKey: role.key, organisationId: org.id };
      const relationship: Relationship = {
        from: { kind: "person", id: personId },
        to: { kind: "organisation", id: org.id },
        kind: "staff_of",
      };
      it.effect("creates organisations and preserves a taken id", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          expect(yield* UnitOfWork.atomic(store.insertOrganisation(org))).toBe(true);
          expect(
            yield* UnitOfWork.atomic(store.insertOrganisation({ ...org, name: "Other" })),
          ).toBe(false);
          expect(yield* store.organisation(org.id)).toEqual(org);
          expect(yield* store.organisation("missing")).toBeUndefined();
          const person = yield* PersonStore;
          yield* UnitOfWork.atomic(
            person.insertIfFree({ id: personId, displayName: "Person", createdAt: 0 }),
          );
        }),
      );
      it.effect("relates and unrelates directionally and idempotently", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          expect(yield* store.isRelated(relationship)).toBe(false);
          yield* UnitOfWork.atomic(store.relate(relationship));
          yield* UnitOfWork.atomic(store.relate(relationship));
          expect(yield* store.isRelated(relationship)).toBe(true);
          expect(
            yield* store.isRelated({
              ...relationship,
              from: relationship.to,
              to: relationship.from,
            }),
          ).toBe(false);
          yield* UnitOfWork.atomic(store.unrelate(relationship));
          expect(yield* store.isRelated(relationship)).toBe(false);
        }),
      );
      it.effect("upserts roles and returns independent permissions", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          yield* UnitOfWork.atomic(store.putRole(role));
          yield* UnitOfWork.atomic(store.putRole({ ...role, name: "Updated" }));
          expect(yield* store.role(role.key)).toEqual({ ...role, name: "Updated" });
          const rows = yield* store.roles();
          expect(rows).toHaveLength(1);
          expect(rows[0]).not.toBe(role);
        }),
      );
      it.effect("assigns global and scoped roles, deduplicates and revokes exactly", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          yield* UnitOfWork.atomic(store.assign(assignment));
          yield* UnitOfWork.atomic(store.assign(assignment));
          yield* UnitOfWork.atomic(store.assign({ ...assignment, organisationId: null }));
          expect(yield* store.assignments(personId)).toHaveLength(2);
          yield* UnitOfWork.atomic(store.revoke(assignment));
          expect(yield* store.assignments(personId)).toEqual([
            { ...assignment, organisationId: null },
          ]);
        }),
      );
      it.effect("all model writes require an open unit", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          for (const call of [
            store.insertOrganisation(org),
            store.relate(relationship),
            store.unrelate(relationship),
            store.putRole(role),
            store.deleteRole(role.key),
            store.assign(assignment),
            store.revoke(assignment),
          ]) {
            expect(yield* Effect.flip(call)).toBeInstanceOf(NoOpenUnit);
          }
        }),
      );
      it.effect("rolls back all model mutations and restores deleted assignments", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          const before = yield* store.assignments(personId);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.insertOrganisation({ id: "rolled-back", name: "Gone" });
                  yield* store.relate(relationship);
                  yield* store.putRole({ ...role, name: "Changed" });
                  yield* store.assign(assignment);
                  yield* store.deleteRole(role.key);
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.organisation("rolled-back")).toBeUndefined();
          expect(yield* store.isRelated(relationship)).toBe(false);
          expect((yield* store.role(role.key))?.name).toBe("Updated");
          expect(yield* store.assignments(personId)).toEqual(before);
        }),
      );
      it.effect("restores repeated assignment changes without affecting another scope", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          const global = { ...assignment, organisationId: null };
          const before = yield* store.assignments(personId);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* store.revoke(global);
                  yield* store.assign(global);
                  yield* store.revoke(global);
                  yield* store.assign(assignment);
                  yield* store.assign(assignment);
                  yield* store.revoke(assignment);
                  yield* store.assign(assignment);
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(yield* store.assignments(personId)).toEqual(before);
          expect(yield* store.holderIds(role.key, null, 10)).toEqual([personId]);
          expect(yield* store.holderIds(role.key, org.id, 10)).toEqual([]);
        }),
      );
      it.effect("deleting a role removes its assignments", () =>
        Effect.gen(function* () {
          const store = yield* PartyStore;
          yield* UnitOfWork.atomic(store.deleteRole(role.key));
          expect(yield* store.role(role.key)).toBeUndefined();
          expect(yield* store.assignments(personId)).toEqual([]);
        }),
      );
    },
  );
}
