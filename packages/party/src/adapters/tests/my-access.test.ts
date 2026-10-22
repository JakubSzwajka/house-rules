import { assert, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { Party } from "../../index.js";
import { PermissionCatalogue } from "@house-rules/application";
import { stores } from "./stores.js";
for (const store of stores) {
  const world = Party.layer({
    builtInRoles: { reader: { name: "Reader", permissions: ["party:read"] } },
  }).pipe(
    Layer.provideMerge(store.layer),
    Layer.provide(
      Layer.succeed(PermissionCatalogue, { permissions: () => Effect.succeed(["party:read"]) }),
    ),
  );
  layer(world, { excludeTestServices: true })(`own access on ${store.name}`, (it) => {
    it.effect("A/B access returns only the caller's assignments and rejects system reads", () =>
      Effect.gen(function* () {
        const party = yield* Party;
        const system = { kind: "system", reason: "setup", startedBy: "test" } as const;
        const a = ActorId.make("access-a");
        const b = ActorId.make("access-b");
        yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            yield* party.createPerson({ id: a, displayName: "A" });
            yield* party.createPerson({ id: b, displayName: "B" });
            yield* party.assignRole(system, {
              personId: a,
              roleKey: "reader",
              organisationId: null,
            });
          }),
        );
        const first = yield* party.myAccess({
          kind: "person",
          actor: Actor.make({ id: a }),
          via: "test",
        });
        const second = yield* party.myAccess({
          kind: "person",
          actor: Actor.make({ id: b }),
          via: "test",
        });
        assert.deepStrictEqual(
          first.roles.map((role) => role.personId),
          [a],
        );
        assert.deepStrictEqual(first.permissions, ["party:read"]);
        assert.deepStrictEqual(second.roles, []);
        assert.deepStrictEqual(second.permissions, []);
        assert.deepStrictEqual(first.catalogue, second.catalogue);
        assert.strictEqual((yield* party.myAccess(system).pipe(Effect.flip))._tag, "PartyDenied");
      }),
    );
  });
}
