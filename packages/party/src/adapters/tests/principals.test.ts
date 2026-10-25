import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Exit, Layer } from "effect";
import {
  Party,
  PartyMount,
  PersonAlreadyExists,
  PersonCallerDenied,
  PersonInputInvalid,
  PersonNotFound,
  PrincipalDisabledRefused,
  PrincipalKindRefused,
} from "../../index.js";
import { stores } from "./stores.js";
import { principalsTesting } from "./principals-testing.js";

const {
  create,
  personCreate,
  disable,
  personDisable,
  lock,
  personLock,
  read,
  personRead,
  doubleCreate,
  features,
  request,
  input,
  actor,
} = principalsTesting;

for (const { name, layer: storage } of stores) {
  const world = Runtime.layer({ mounts: [PartyMount], features, ways: [] }).pipe(
    Layer.provideMerge(
      Party.layer({
        builtInRoles: { agent: { name: "Agent", permissions: ["party:read"] } },
        handles: { pattern: /^[a-z][a-z0-9-]{0,31}$/u, reserved: ["me", "none"] },
      }).pipe(Layer.provideMerge(storage)),
    ),
    Layer.provideMerge(StepTrace.layer()),
    Layer.provideMerge(request),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Principals on ${name}`,
    (it) => {
      it.effect(
        "creates both kinds with provenance and module-owned facts; old Person reads stay unchanged",
        () =>
          Effect.gen(function* () {
            const party = yield* Party;
            for (const kind of ["person", "agent"] as const) {
              const created = yield* runFeature(create, input(`kind-${kind}`, kind));
              expect(created.principal).toMatchObject({
                kind,
                handle: `kind-${kind}`,
                createdBy: actor.id,
                disabledAt: null,
              });
              expect(created.fact).toEqual({ kind: "principal.created", after: created.principal });
              expect(yield* party.standingOf(created.principal.id)).toBe("active");
              expect(yield* party.get(actor, created.principal.id)).toEqual({
                id: created.principal.id,
                displayName: created.principal.displayName,
                createdAt: created.principal.createdAt,
              });
            }
            expect(yield* party.standingOf(ActorId.make("principal-missing"))).toBe("missing");
            const legacy = yield* UnitOfWork.atomic(
              party.createPerson({ id: ActorId.make("Legacy_ID/uuid:123"), displayName: "Legacy" }),
            );
            expect(yield* runFeature(read, { ids: [legacy.id] })).toMatchObject([
              { kind: "person", handle: legacy.id, createdBy: null, disabledAt: null },
            ]);
          }),
      );
      it.effect(
        "validates configured handle patterns and reserved words without normalization",
        () =>
          Effect.gen(function* () {
            for (const handle of [
              "",
              "me",
              "none",
              "Uppercase",
              "contains space",
              "a".repeat(33),
            ]) {
              expect(yield* Effect.flip(runFeature(create, input(handle)))).toBeInstanceOf(
                PersonInputInvalid,
              );
            }
            const handle = "a".repeat(32);
            expect((yield* runFeature(create, input(handle))).principal.handle).toBe(handle);
          }),
      );
      it.effect("enforces handle uniqueness across kinds, including concurrent distinct ids", () =>
        Effect.gen(function* () {
          const first = yield* runFeature(create, input("unique", "person"));
          expect(
            yield* Effect.flip(
              runFeature(create, { ...input("unique"), id: ActorId.make("other-unique-id") }),
            ),
          ).toBeInstanceOf(PersonAlreadyExists);
          const results = yield* Effect.forEach(
            ["a", "b"],
            (suffix) =>
              Effect.exit(
                runFeature(create, {
                  ...input("concurrent"),
                  id: ActorId.make(`concurrent-${suffix}`),
                }),
              ),
            { concurrency: "unbounded" },
          );
          expect(results.filter(Exit.isSuccess)).toHaveLength(1);
          expect(results.filter(Exit.isFailure)).toHaveLength(1);
          expect((yield* runFeature(read, { ids: [first.principal.id] }))[0]).toEqual(
            first.principal,
          );
        }),
      );
      it.effect("rolls principal writes and disable facts back with their feature unit", () =>
        Effect.gen(function* () {
          const party = yield* Party;
          const target = input("rollback");
          expect(yield* Effect.flip(runFeature(doubleCreate, target))).toBeInstanceOf(
            PersonAlreadyExists,
          );
          expect(yield* party.standingOf(target.id)).toBe("missing");
          const created = yield* runFeature(create, target);
          yield* Effect.exit(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* runFeature(disable, { id: created.principal.id });
                return yield* new PersonAlreadyExists();
              }),
            ),
          );
          expect(yield* party.standingOf(target.id)).toBe("active");
        }),
      );
      it.effect(
        "disable is permanent and idempotent, returns before/after facts and empties May",
        () =>
          Effect.gen(function* () {
            const party = yield* Party;
            const created = yield* runFeature(create, input("disable"));
            yield* UnitOfWork.atomic(
              party.assignRole(
                { kind: "system", reason: "Seed", startedBy: "tests" },
                { personId: created.principal.id, roleKey: "agent", organisationId: null },
              ),
            );
            const caller = {
              kind: "person",
              actor: Actor.make({ id: created.principal.id }),
              via: "test",
            } as const;
            expect(yield* party.permissionsOf(caller)).toEqual(["party:read"]);
            const result = yield* runFeature(disable, { id: created.principal.id });
            expect(result.principal.disabledAt).toEqual(expect.any(Number));
            expect(result.fact).toEqual({
              kind: "principal.disabled",
              before: created.principal,
              after: result.principal,
            });
            expect(yield* party.standingOf(created.principal.id)).toBe("disabled");
            expect(yield* party.permissionsOf(caller)).toEqual([]);
            expect(yield* runFeature(disable, { id: created.principal.id })).toEqual({
              principal: result.principal,
              fact: null,
            });
            expect(
              yield* Effect.flip(runFeature(disable, { id: ActorId.make("disable-unknown") })),
            ).toBeInstanceOf(PersonNotFound);
            expect("enable" in party).toBe(false);
          }),
      );
      it.effect(
        "lockActive rejects unknown, wrong-kind owner and disabled targets; both callers can lock",
        () =>
          Effect.gen(function* () {
            expect(
              yield* Effect.flip(runFeature(lock, { handle: "absent", kind: "agent" })),
            ).toBeInstanceOf(PersonNotFound);
            yield* runFeature(create, input("owner", "person"));
            expect(
              yield* Effect.flip(runFeature(lock, { handle: "owner", kind: "agent" })),
            ).toBeInstanceOf(PrincipalKindRefused);
            const created = yield* runFeature(create, input("lock"));
            expect(yield* runFeature(lock, { handle: "lock", kind: "agent" })).toEqual(
              created.principal,
            );
            expect(yield* runFeature(personLock, { handle: "lock", kind: "agent" })).toEqual(
              created.principal,
            );
            yield* runFeature(disable, { id: created.principal.id });
            expect(
              yield* Effect.flip(runFeature(lock, { handle: "lock", kind: "agent" })),
            ).toBeInstanceOf(PrincipalDisabledRefused);
          }),
      );
      it.effect("person callers cannot distinguish unknown, wrong-kind and disabled handles", () =>
        Effect.gen(function* () {
          yield* runFeature(create, input("hidden-owner", "person"));
          const missing = yield* Effect.flip(
            runFeature(personLock, { handle: "hidden-absent", kind: "agent" }),
          );
          const wrongKind = yield* Effect.flip(
            runFeature(personLock, { handle: "hidden-owner", kind: "agent" }),
          );
          const created = yield* runFeature(create, input("hidden-disabled"));
          yield* runFeature(disable, { id: created.principal.id });
          const disabled = yield* Effect.flip(
            runFeature(personLock, { handle: "hidden-disabled", kind: "agent" }),
          );
          expect(missing).toBeInstanceOf(PersonNotFound);
          expect(wrongKind).toBeInstanceOf(PersonNotFound);
          expect(disabled).toBeInstanceOf(PersonNotFound);
          expect(wrongKind).toEqual(missing);
          expect(disabled).toEqual(missing);
          expect(
            yield* Effect.flip(runFeature(lock, { handle: "hidden-disabled", kind: "agent" })),
          ).toBeInstanceOf(PrincipalDisabledRefused);
        }),
      );
      it.effect(
        "only system callers mutate principals; person and system callers may read ids",
        () =>
          Effect.gen(function* () {
            expect(yield* Effect.flip(runFeature(personCreate, input("denied")))).toBeInstanceOf(
              PersonCallerDenied,
            );
            const created = yield* runFeature(create, input("read"));
            expect(
              yield* Effect.flip(runFeature(personDisable, { id: created.principal.id })),
            ).toBeInstanceOf(PersonCallerDenied);
            const ids = [created.principal.id, ActorId.make("read-missing"), created.principal.id];
            expect(yield* runFeature(read, { ids })).toEqual([created.principal]);
            expect(yield* runFeature(personRead, { ids })).toEqual([created.principal]);
            expect(yield* runFeature(read, { ids: [] })).toEqual([]);
          }),
      );
    },
  );
}
