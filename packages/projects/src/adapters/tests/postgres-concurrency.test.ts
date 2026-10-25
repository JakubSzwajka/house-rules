import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Projects } from "../../index.js";
import { stores } from "./stores.js";

const world = Projects.layer(Projects.presets.default).pipe(Layer.provideMerge(stores[0].layer));
const actor = Actor.make({ id: ActorId.make("owner") });

layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
  "Postgres project concurrency",
  (it) => {
    it.effect("returns a slug conflict while the first create holds its unit open", () =>
      Effect.gen(function* () {
        const projects = yield* Projects;
        const sql = yield* SqlClient;
        const inserted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const secondPid = yield* Deferred.make<number>();
        const input = { slug: "overlapping", name: "Overlapping" };
        const first = yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            const result = yield* projects.create(actor, input);
            // The row and advisory lock stay uncommitted until the other writer blocks.
            yield* Deferred.succeed(inserted, undefined);
            yield* Deferred.await(release);
            return result;
          }),
        ).pipe(Effect.forkScoped);
        yield* Deferred.await(inserted);
        const second = yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            const rows = yield* sql<{ pid: number }>`select pg_backend_pid() as pid`;
            const pid = Number(rows[0]?.pid);
            expect(pid).toBeGreaterThan(0);
            yield* Deferred.succeed(secondPid, pid);
            return yield* projects.create(actor, input);
          }),
        ).pipe(Effect.result, Effect.forkScoped);
        const pid = yield* Deferred.await(secondPid);
        // Wait for advisory or unique-index blocking so removing the lock still forces overlap.
        yield* sql`select pid from pg_stat_activity where pid = ${pid} and wait_event_type = 'Lock'`.pipe(
          Effect.repeat({
            schedule: Schedule.spaced("5 millis"),
            until: (rows) => rows.length === 1,
          }),
          Effect.timeout("1 second"),
        );
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(first)).project.slug).toBe(input.slug);
        expect(yield* Fiber.join(second)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ProjectSlugTaken", kind: "conflict" },
        });
        expect(yield* projects.list(actor)).toHaveLength(1);
      }).pipe(Effect.scoped, Effect.timeout("2 seconds")),
    );
  },
);
