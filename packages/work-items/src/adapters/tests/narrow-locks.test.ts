import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { WorkItems, WorkItemTreeTooLarge } from "../../index.js";
import { MoveImportTesting } from "./move-import-testing.js";
import { stores } from "./stores.js";

const { options, access, ref } = MoveImportTesting;
const actor = Actor.make({ id: ActorId.make("owner") });
const world = WorkItems.layer(options).pipe(
  Layer.provideMerge(stores[0].layer),
  Layer.provide(access),
);

const waitingForContainer = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`select pid from pg_stat_activity where datname = current_database() and wait_event = 'advisory' and query like '%pg_advisory_xact_lock%'`.pipe(
    Effect.repeat({ until: (rows) => rows.length > 0, schedule: Schedule.spaced("10 millis") }),
  );
  return "waiting" as const;
});

layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
  "Postgres narrow locks",
  (it) => {
    it.effect("holds the target lock until a competing move sees the committed last space", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const target = ref("held-move-target");
        const a = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "a", container: ref("held-a") }),
        )).item;
        const b = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "b", container: ref("held-b") }),
        )).item;
        for (let i = 0; i < options.maxTreeSize - 1; i++)
          yield* UnitOfWork.atomic(service.create(actor, { title: "existing", container: target }));
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const first = yield* UnitOfWork.atomic(
          service
            .move(actor, a.id, { container: target })
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const second = yield* UnitOfWork.atomic(
          service.move(actor, b.id, { container: target }),
        ).pipe(Effect.result, Effect.forkChild);
        const state = yield* Effect.raceFirst(
          waitingForContainer,
          Fiber.join(second).pipe(Effect.as("completed" as const)),
        ).pipe(Effect.timeout("5 seconds"));
        expect(state).toBe("waiting");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        const outcome = yield* Fiber.join(second);
        expect(outcome._tag).toBe("Failure");
        if (outcome._tag === "Failure") expect(outcome.failure).toEqual(new WorkItemTreeTooLarge());
      }),
    );
    it.effect("waits for a concurrent create before checking a move's target size", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const target = ref("held-create-target");
        const source = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "source", container: ref("held-create-source") }),
        )).item;
        for (let i = 0; i < options.maxTreeSize - 1; i++)
          yield* UnitOfWork.atomic(service.create(actor, { title: "existing", container: target }));
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const creator = yield* UnitOfWork.atomic(
          service
            .create(actor, { title: "last space", container: target })
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const mover = yield* UnitOfWork.atomic(
          service.move(actor, source.id, { container: target }),
        ).pipe(Effect.result, Effect.forkChild);
        expect(
          yield* Effect.raceFirst(
            waitingForContainer,
            Fiber.join(mover).pipe(Effect.as("completed" as const)),
          ).pipe(Effect.timeout("5 seconds")),
        ).toBe("waiting");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(creator);
        const outcome = yield* Fiber.join(mover);
        expect(outcome._tag).toBe("Failure");
        if (outcome._tag === "Failure") expect(outcome.failure).toEqual(new WorkItemTreeTooLarge());
      }),
    );
    it.effect("preserves a descendant edit committed while a move waits for its row", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const root = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "root", container: ref("editing-source") }),
        )).item;
        const child = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "child", parent: root.id }),
        )).item;
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const editor = yield* UnitOfWork.atomic(
          service
            .edit(actor, child.id, { title: "edited concurrently" })
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const mover = yield* UnitOfWork.atomic(
          service.move(actor, root.id, { container: ref("editing-target") }),
        ).pipe(Effect.forkChild);
        const sql = yield* SqlClient;
        yield* sql`select pid from pg_stat_activity where datname = current_database() and wait_event = 'transactionid'`.pipe(
          Effect.repeat({
            until: (rows) => rows.length > 0,
            schedule: Schedule.spaced("10 millis"),
          }),
          Effect.timeout("5 seconds"),
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(editor);
        yield* Fiber.join(mover);
        expect(yield* service.getForSystem(child.id)).toMatchObject({
          title: "edited concurrently",
          container: ref("editing-target"),
        });
      }),
    );
    it.effect("does not hold the sequence lock until an importing transaction commits", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const importer = yield* UnitOfWork.atomic(
          service
            .import([MoveImportTesting.stored("90000", ref("held-import"))])
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const created = yield* UnitOfWork.atomic(
          service.create(actor, { title: "unrelated", container: ref("unrelated-import") }),
        ).pipe(Effect.timeout("5 seconds"));
        expect(BigInt(created.item.id)).toBeGreaterThan(90000n);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(importer);
      }),
    );
    it.effect("completes an unrelated move while the first move's transaction stays open", () =>
      Effect.gen(function* () {
        const service = yield* WorkItems;
        const a = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "a", container: ref("independent-a") }),
        )).item;
        const child = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "child", parent: a.id }),
        )).item;
        const b = (yield* UnitOfWork.atomic(
          service.create(actor, { title: "b", container: ref("independent-b") }),
        )).item;
        const ready = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const first = yield* UnitOfWork.atomic(
          service
            .move(actor, a.id, { container: ref("independent-new-a") })
            .pipe(
              Effect.andThen(Deferred.succeed(ready, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        const moved = yield* UnitOfWork.atomic(
          service.move(actor, b.id, { container: ref("independent-new-b") }),
        ).pipe(Effect.timeout("5 seconds"));
        expect(moved.item.container).toEqual(ref("independent-new-b"));
        // The first transaction is still uncommitted while the second has completed.
        expect((yield* service.getForSystem(a.id)).container).toEqual(ref("independent-a"));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        expect((yield* service.getForSystem(child.id)).container).toEqual(ref("independent-new-a"));
      }),
    );
  },
);
