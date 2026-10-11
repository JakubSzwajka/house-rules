import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Migrations } from "../index.ts";
import {
  ADOPT_ALL,
  historyOf,
  legacyApp,
  moduleTree,
  noneWritten,
  options,
  tableExists,
  testDatabase,
  WORK_OWNER_EDITED,
} from "./legacy-app.ts";

layer(testDatabase("adopt_refuse"), options)(
  "Migrations, an adoption that does not add up",
  (it) => {
    it.effect("refuses an id in the old table that no module claims, and writes nothing", () =>
      Effect.gen(function* unclaimed() {
        const { app, old } = yield* legacyApp(
          moduleTree({ ...ADOPT_ALL, people: { from: "db_migrations", ids: [2] } }),
        );
        const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
        expect(error.message).toBe(
          `Adopting from db_migrations: migration 5_people_name is claimed by no module. Add its id to one module's "adopt.ids".`,
        );
        yield* noneWritten();
        expect(yield* historyOf("db_migrations")).toEqual(old);
      }),
    );
  },
);

layer(testDatabase("adopt_missing"), options)("Migrations, adopting a missing id", (it) => {
  it.effect("refuses a claimed id the old table does not hold, and writes nothing", () =>
    Effect.gen(function* missing() {
      const { app, old } = yield* legacyApp(
        moduleTree(
          { ...ADOPT_ALL, work: { from: "db_migrations", ids: [3, 4, 7] } },
          {},
          {
            "packages/work/migrations/0007_task_seven.sql":
              "create table task_seven (id integer);\n",
          },
        ),
      );
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error.message).toBe(
        "Module work: adopts migration 7 from db_migrations, which db_migrations does not hold.",
      );
      yield* noneWritten();
      expect(yield* tableExists("task_seven")).toBe(false);
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});

layer(testDatabase("adopt_rehash"), options)("Migrations, rehashing an edited file", (it) => {
  it.effect("fails on an edited file not listed in rehash, as before", () =>
    Effect.gen(function* notListed() {
      const { app, old } = yield* legacyApp(
        moduleTree(
          { ...ADOPT_ALL, work: { from: "db_migrations", ids: [3, 4], rehash: [3] } },
          { 4: WORK_OWNER_EDITED },
        ),
      );
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error.message).toBe(
        "Module work: applied migration 4_work_owner was edited after it ran. Migrations are append-only.",
      );
      yield* noneWritten();
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});

layer(testDatabase("adopt_rollback"), options)("Migrations, a failure after adopting", (it) => {
  it.effect("rolls back the adoption with every other write", () =>
    Effect.gen(function* rollsBack() {
      const { app, old } = yield* legacyApp(
        moduleTree(
          ADOPT_ALL,
          {},
          {
            "packages/work/migrations/0006_task_extra.sql":
              "create table task_extra (id integer);\n",
            "node_modules/@vendor/beta/sql/0002_beta_broken.sql":
              "alter table no_such_table add column x text;\n",
          },
        ),
      );
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error._tag).toBe("MigrationFailed");
      expect(error.message).toContain("Module beta");
      yield* noneWritten();
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});
