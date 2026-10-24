import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { Party, PartyMount, PrincipalDisabledRefused } from "../../index.js";
import { stores } from "./stores.js";
import { principalsTesting } from "./principals-testing.js";

const { backendPid, waitForBlocked, create, disable, lock, features, request, input } =
  principalsTesting;

for (const { name, layer: storage } of stores) {
  const world = Runtime.layer({ mounts: [PartyMount], features, ways: [] }).pipe(
    Layer.provideMerge(Party.layer({ builtInRoles: {} }).pipe(Layer.provideMerge(storage))),
    Layer.provideMerge(StepTrace.layer()),
    Layer.provideMerge(request),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Principal races on ${name}`,
    (it) => {
      it.effect("concurrent disables return exactly one change fact", () =>
        Effect.gen(function* () {
          const created = yield* runFeature(create, input("disable-concurrent", "person"));
          const disabled = yield* Deferred.make<number | undefined>();
          const release = yield* Deferred.make<void>();
          const first = yield* Effect.forkChild(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                const result = yield* runFeature(disable, { id: created.principal.id });
                yield* Deferred.succeed(disabled, yield* backendPid);
                yield* Deferred.await(release);
                return result;
              }),
            ),
          );
          const pid = yield* Deferred.await(disabled);
          const started = yield* Deferred.make<void>();
          const second = yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* runFeature(disable, { id: created.principal.id });
            }),
          );
          yield* Deferred.await(started);
          yield* waitForBlocked(pid, () => second.pollUnsafe() === undefined);
          yield* Deferred.succeed(release, undefined);
          const results = [yield* Fiber.join(first), yield* Fiber.join(second)];
          expect(results.filter((r) => r.fact !== null)).toHaveLength(1);
          expect(results[0]?.principal).toEqual(results[1]?.principal);
        }),
      );
      it.effect(
        "disable waits for a lock held in another unit; locks after its commit refuse",
        () =>
          Effect.gen(function* () {
            const created = yield* runFeature(create, input("race"));
            const locked = yield* Deferred.make<number | undefined>();
            const release = yield* Deferred.make<void>();
            const disablerStarted = yield* Deferred.make<void>();
            const holder = yield* Effect.forkChild(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* runFeature(lock, { handle: "race", kind: "agent" });
                  yield* Deferred.succeed(locked, yield* backendPid);
                  yield* Deferred.await(release);
                }),
              ),
            );
            const pid = yield* Deferred.await(locked);
            const disabler = yield* Effect.forkChild(
              Effect.gen(function* () {
                yield* Deferred.succeed(disablerStarted, undefined);
                return yield* runFeature(disable, { id: created.principal.id });
              }),
            );
            yield* Deferred.await(disablerStarted);
            yield* waitForBlocked(pid, () => disabler.pollUnsafe() === undefined);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(holder);
            expect((yield* Fiber.join(disabler)).principal.disabledAt).not.toBeNull();
            expect(
              yield* Effect.flip(runFeature(lock, { handle: "race", kind: "agent" })),
            ).toBeInstanceOf(PrincipalDisabledRefused);
          }),
      );
      it.effect("lockActive waits for an open disable unit, then sees disabled", () =>
        Effect.gen(function* () {
          const created = yield* runFeature(create, input("disable-first"));
          const disabled = yield* Deferred.make<number | undefined>();
          const release = yield* Deferred.make<void>();
          const disabler = yield* Effect.forkChild(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* runFeature(disable, { id: created.principal.id });
                yield* Deferred.succeed(disabled, yield* backendPid);
                yield* Deferred.await(release);
              }),
            ),
          );
          const pid = yield* Deferred.await(disabled);
          const started = yield* Deferred.make<void>();
          const locker = yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.flip(
                runFeature(lock, { handle: "disable-first", kind: "agent" }),
              );
            }),
          );
          yield* Deferred.await(started);
          yield* waitForBlocked(pid, () => locker.pollUnsafe() === undefined);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(disabler);
          expect(yield* Fiber.join(locker)).toBeInstanceOf(PrincipalDisabledRefused);
        }),
      );
    },
  );
}
