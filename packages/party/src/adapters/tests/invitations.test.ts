import { assert, it } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Layer } from "effect";
import { Party, PartyStore } from "../../index.js";
import { PermissionCatalogue } from "@house-rules/application";
import { fixtureTesting, partyOptionsTesting } from "./party-access-testing.js";
import { stores } from "./stores.js";

for (const store of stores) {
  const layer = Party.layer(partyOptionsTesting).pipe(
    Layer.provideMerge(store.layer),
    Layer.provide(
      Layer.succeed(PermissionCatalogue, {
        permissions: () => Effect.succeed(["party:admin", "party:read"]),
      }),
    ),
  );
  it.layer(layer)(`${store.name}: invitations`, (it) => {
    const fixture = fixtureTesting();
    it.effect(
      "hashes codes, delegates in scope, accepts only once, and filters lists and people",
      () =>
        UnitOfWork.atomic(
          Effect.gen(function* () {
            const { party, scoped, person, admin, x, y } = yield* fixture();
            const denied = yield* party
              .createInvitation(scoped, { organisationId: y.id, roleKey: null })
              .pipe(Effect.flip);
            assert.strictEqual(denied._tag, "PartyDenied");
            assert.strictEqual(
              (yield* party.listInvitations(scoped, y.id).pipe(Effect.flip))._tag,
              "PartyDenied",
            );
            const created = yield* party.createInvitation(scoped, {
              organisationId: x.id,
              roleKey: "reader",
            });
            const stored = yield* (yield* PartyStore).invitation(created.invitation.id);
            assert.notStrictEqual(stored?.codeHash, created.code);
            assert.strictEqual(stored?.codeHash.length, 64);
            assert.notProperty((yield* party.listInvitations(scoped, x.id))[0], "codeHash");
            const accepted = yield* party.acceptInvitation(person, created.code);
            assert.strictEqual(accepted.personId, person.actor.id);
            assert.strictEqual(accepted.roleKey, "reader");
            assert.isTrue(
              yield* party.isRelated({
                from: { kind: "person", id: person.actor.id },
                to: { kind: "organisation", id: x.id },
                kind: "staff",
              }),
            );
            assert.strictEqual(
              (yield* party.acceptInvitation(person, created.code).pipe(Effect.flip))._tag,
              "PartyNotFound",
            );
            assert.deepStrictEqual(
              (yield* party.listPeople(scoped)).map((p) => p.id).sort(),
              [admin.actor.id, person.actor.id].sort(),
            );
            assert.isTrue((yield* party.listPeople(admin)).length >= 3);
            assert.strictEqual(
              (yield* party.listPeople(person).pipe(Effect.flip))._tag,
              "PartyDenied",
            );
            assert.deepStrictEqual(yield* party.myOrganisations(person), [
              { ...x, relation: "staff", roles: [] },
            ]);
            const noEscalation = yield* party.defineRole(admin, {
              key: `${x.id}-power`,
              name: "Power",
              permissions: ["party:admin", "party:read"],
              organisationId: x.id,
            });
            yield* party.assignRole(admin, {
              personId: person.actor.id,
              roleKey: "reader",
              organisationId: x.id,
            });
            assert.strictEqual(
              (yield* party
                .createInvitation(person, { organisationId: x.id, roleKey: noEscalation.key })
                .pipe(Effect.flip))._tag,
              "PartyDenied",
            );
          }),
        ),
    );
    it.effect("revoked, expired and unknown codes are the same not_found", () =>
      UnitOfWork.atomic(
        Effect.gen(function* () {
          const { party, scoped, person, x } = yield* fixture();
          const revoked = yield* party.createInvitation(scoped, {
            organisationId: x.id,
            roleKey: null,
          });
          yield* party.revokeInvitation(scoped, revoked.invitation.id);
          for (const code of [revoked.code, "missing"])
            assert.strictEqual(
              (yield* party.acceptInvitation(person, code).pipe(Effect.flip))._tag,
              "PartyNotFound",
            );
          const store = yield* PartyStore;
          const revokedRow = yield* store.invitation(revoked.invitation.id);
          assert.isDefined(revokedRow);
          yield* store.insertInvitation({
            ...revokedRow,
            id: `${x.id}-expired`,
            codeHash: "expired",
            state: "pending",
            expiresAt: (yield* Clock.currentTimeMillis) - 1,
          });
          assert.isUndefined(
            yield* store.consumeInvitation("expired", yield* Clock.currentTimeMillis),
          );
        }),
      ),
    );
    it.effect("rollback restores a claimed code", () =>
      Effect.gen(function* () {
        const f = yield* UnitOfWork.atomic(fixture());
        const created = yield* UnitOfWork.atomic(
          f.party.createInvitation(f.scoped, { organisationId: f.x.id, roleKey: null }),
        );
        yield* UnitOfWork.atomic(
          f.party
            .acceptInvitation(f.person, created.code)
            .pipe(Effect.andThen(Effect.fail("rollback"))),
        ).pipe(Effect.ignore);
        assert.strictEqual(
          (yield* UnitOfWork.atomic(f.party.acceptInvitation(f.person, created.code)))
            .organisationId,
          f.x.id,
        );
      }),
    );
  });
}
