import { expect, layer } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { Migrations } from "../index.ts";
import {
  ADOPT_ALL,
  historyOf,
  legacyApp,
  moduleTree,
  noneWritten,
  oldRunner,
  options,
  testDatabase,
  waitForLockWaiters,
} from "./legacy-app.ts";

const OLD_IDS = [1, 2, 3, 4, 5];

layer(testDatabase("adopt_old_first", 6), options)(
  "Migrations, the old runner holds the lock",
  (it) => {
    it.effect("queues the new runner behind it, and both finish", () =>
      Effect.gen(function* oldFirst() {
        const { app, old } = yield* legacyApp(moduleTree(ADOPT_ALL));
        const acquired = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const oldRun = yield* oldRunner(
          Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Deferred.await(release))),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(acquired);
        const newRun = yield* Migrations.runList(app.list).pipe(Effect.forkChild);
        yield* waitForLockWaiters(1);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(oldRun)).toEqual(OLD_IDS);
        const report = yield* Fiber.join(newRun);
        expect(report.flatMap((module) => module.adoption?.adopted ?? []).length).toBe(5);
        expect(yield* historyOf("db_migrations")).toEqual(old);
      }),
    );
  },
);

layer(testDatabase("adopt_new_first", 6), options)(
  "Migrations, the new runner holds the lock",
  (it) => {
    it.effect("queues the old runner behind the adopting run, and both finish", () =>
      Effect.gen(function* newFirst() {
        const { app, old } = yield* legacyApp(moduleTree(ADOPT_ALL));
        const sql = yield* SqlClient;
        // The first copied row stops on a gate lock, which holds the new runner inside its transaction.
        yield* sql`create table log_migrations (like db_migrations including all)`;
        yield* sql.unsafe(`create function pause_adoption() returns trigger language plpgsql as $$
        begin perform pg_advisory_xact_lock(hashtextextended('adoption_gate', 0)); return new; end $$`);
        yield* sql`create trigger pause_adoption before insert on log_migrations
        for each row execute function pause_adoption()`;
        const acquired = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const gate = yield* sql
          .withTransaction(
            Effect.gen(function* holdGate() {
              yield* sql`select pg_advisory_xact_lock(hashtextextended('adoption_gate', 0))`;
              yield* Deferred.succeed(acquired, undefined);
              yield* Deferred.await(release);
            }),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(acquired);
        const newRun = yield* Migrations.runList(app.list).pipe(Effect.forkChild);
        yield* waitForLockWaiters(1);
        const oldRun = yield* oldRunner().pipe(Effect.forkChild);
        yield* waitForLockWaiters(2);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(gate);
        const report = yield* Fiber.join(newRun);
        expect(report.flatMap((module) => module.adoption?.adopted ?? []).length).toBe(5);
        expect(yield* Fiber.join(oldRun)).toEqual(OLD_IDS);
        expect(yield* historyOf("db_migrations")).toEqual(old);
      }),
    );
  },
);

layer(testDatabase("adopt_old_add", 6), options)(
  "Migrations, the old runner appends first",
  (it) => {
    it.effect("refuses the row it appended before the adoption, and writes nothing", () =>
      Effect.gen(function* oldAppends() {
        const { app } = yield* legacyApp(moduleTree(ADOPT_ALL));
        const sql = yield* SqlClient;
        const acquired = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const oldRun = yield* oldRunner(
          Effect.gen(function* append() {
            yield* sql`insert into db_migrations (migration_id, name) values (12, 'old_added')`;
            yield* Deferred.succeed(acquired, undefined);
            yield* Deferred.await(release);
          }),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(acquired);
        const newRun = yield* Migrations.runList(app.list).pipe(Effect.flip, Effect.forkChild);
        yield* waitForLockWaiters(1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(oldRun);
        const error = yield* Fiber.join(newRun);
        expect(error.message).toContain("migration 12_old_added is claimed by no module");
        yield* noneWritten();
      }),
    );
  },
);

layer(testDatabase("adopt_partial"), options)("Migrations, a partly adopted list", (it) => {
  it.effect("leaves an already adopted module alone and adopts the rest", () =>
    Effect.gen(function* partlyAdopted() {
      const { app, old } = yield* legacyApp(moduleTree(ADOPT_ALL));
      const sql = yield* SqlClient;
      yield* sql`create table log_migrations (like db_migrations including all)`;
      yield* sql`insert into log_migrations select * from db_migrations where migration_id = 1`;
      const logBefore = yield* historyOf("log_migrations");
      const report = yield* Migrations.runList(app.list);
      expect(report.map((module) => module.adoption?.adopted.length)).toEqual([0, 2, 2, undefined]);
      expect(report.map((module) => module.verified.length)).toEqual([1, 2, 2, 0]);
      expect(report.map((module) => module.applied.length)).toEqual([0, 0, 0, 1]);
      expect(yield* historyOf("log_migrations")).toEqual(logBefore);
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});

layer(testDatabase("adopt_leftout"), options)(
  "Migrations, a list that leaves a claimant out",
  (it) => {
    it.effect("refuses a module list that leaves a claimant out, and writes nothing", () =>
      Effect.gen(function* leftOut() {
        const { app, old } = yield* legacyApp(moduleTree(ADOPT_ALL));
        const modules = yield* Migrations.readModuleList(app.list);
        const error = yield* Migrations.run(modules.slice(0, 1)).pipe(Effect.flip);
        expect(error.message).toBe(
          `Adopting from db_migrations: migration 2_people is claimed by no module. Add its id to one module's "adopt.ids".`,
        );
        yield* noneWritten();
        expect(yield* historyOf("db_migrations")).toEqual(old);
      }),
    );
  },
);
