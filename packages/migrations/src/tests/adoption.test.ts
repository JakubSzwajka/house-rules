import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Migrations } from "../index.ts";
import {
  ADOPT_ALL,
  historyOf,
  legacyApp,
  MODULE_TABLES,
  moduleTree,
  OWNERS,
  options,
  tableExists,
  testDatabase,
  WORK_OWNER_EDITED,
} from "./legacy-app.ts";
import { scratchApp } from "./scratch-app.ts";

layer(testDatabase("adopt_split"), options)("Migrations, adopting into three modules", (it) => {
  it.effect("copies each module's rows once, keeps the old table, and reports them", () =>
    Effect.gen(function* happyPath() {
      const { app, old } = yield* legacyApp(
        moduleTree(
          ADOPT_ALL,
          {},
          {
            "packages/work/migrations/0006_task_extra.sql":
              "create table task_extra (id integer);\n",
          },
        ),
      );
      const report = yield* Migrations.runList(app.list);
      expect(report).toEqual([
        {
          module: "log",
          table: "log_migrations",
          adoption: { from: "db_migrations", adopted: [{ id: 1, name: "log" }], rehashed: [] },
          verified: [{ id: 1, name: "log" }],
          backfilled: [],
          applied: [],
        },
        {
          module: "people",
          table: "people_migrations",
          adoption: {
            from: "db_migrations",
            adopted: [
              { id: 2, name: "people" },
              { id: 5, name: "people_name" },
            ],
            rehashed: [],
          },
          verified: [
            { id: 2, name: "people" },
            { id: 5, name: "people_name" },
          ],
          backfilled: [],
          applied: [],
        },
        {
          module: "work",
          table: "work_migrations",
          adoption: {
            from: "db_migrations",
            adopted: [
              { id: 3, name: "work" },
              { id: 4, name: "work_owner" },
            ],
            rehashed: [],
          },
          verified: [
            { id: 3, name: "work" },
            { id: 4, name: "work_owner" },
          ],
          backfilled: [],
          applied: [{ id: 6, name: "task_extra" }],
        },
        {
          module: "beta",
          table: "beta_migrations",
          verified: [],
          backfilled: [],
          applied: [{ id: 1, name: "beta_entry" }],
        },
      ]);
      // A module without "adopt" reports exactly as before.
      expect(Object.keys(report[3] ?? {})).not.toContain("adoption");
      expect(Migrations.formatReport(report)).toEqual([
        "Migrations log (log_migrations): adopted from db_migrations 1_log; rehashed none; digest verified 1_log; digest backfilled none; applied none.",
        "Migrations people (people_migrations): adopted from db_migrations 2_people, 5_people_name; rehashed none; digest verified 2_people, 5_people_name; digest backfilled none; applied none.",
        "Migrations work (work_migrations): adopted from db_migrations 3_work, 4_work_owner; rehashed none; digest verified 3_work, 4_work_owner; digest backfilled none; applied 6_task_extra.",
        "Migrations beta (beta_migrations): digest verified none; digest backfilled none; applied 1_beta_entry.",
      ]);
      const byId = new Map(old.map((row) => [row.migrationId, row]));
      for (const [name, ids] of Object.entries(OWNERS)) {
        const rows = (yield* historyOf(`${name}_migrations`)).filter(
          (row) => row.migrationId !== 6,
        );
        expect(rows).toEqual(ids.map((id) => byId.get(id)));
      }
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});

layer(testDatabase("adopt_twice"), options)("Migrations, adopting twice", (it) => {
  it.effect("adopts nothing on the second run, even after the old table changed", () =>
    Effect.gen(function* idempotent() {
      const { app } = yield* legacyApp(moduleTree(ADOPT_ALL));
      yield* Migrations.runList(app.list);
      const before = yield* Effect.forEach(MODULE_TABLES, historyOf);
      // The old runner, rolled back to, may still record in its table; the modules have moved on.
      yield* SqlClient.use(
        (sql) => sql`insert into db_migrations (migration_id, name) values (99, 'old_only')`,
      );
      const again = yield* Migrations.runList(app.list);
      expect(again.map((module) => module.adoption?.adopted)).toEqual([[], [], [], undefined]);
      expect(again.flatMap((module) => module.applied)).toEqual([]);
      expect(again.map((module) => module.verified.length)).toEqual([1, 2, 2, 1]);
      expect(yield* Effect.forEach(MODULE_TABLES, historyOf)).toEqual(before);
    }),
  );
});

layer(testDatabase("adopt_fresh"), options)("Migrations, adopting on a fresh database", (it) => {
  it.effect("finds no old table, adopts nothing, and applies every file", () =>
    Effect.gen(function* fresh() {
      const app = yield* scratchApp(moduleTree(ADOPT_ALL));
      const report = yield* Migrations.runList(app.list);
      expect(report.map((module) => module.adoption?.adopted)).toEqual([[], [], [], undefined]);
      expect(report.map((module) => module.applied.length)).toEqual([1, 2, 2, 1]);
      expect(yield* tableExists("db_migrations")).toBe(false);
    }),
  );
});

layer(testDatabase("adopt_rehash_ok"), options)("Migrations, rehashing a listed id", (it) => {
  it.effect("backfills the digest of a listed id only, and keeps the old digest", () =>
    Effect.gen(function* listed() {
      const { app, old } = yield* legacyApp(
        moduleTree(
          { ...ADOPT_ALL, work: { from: "db_migrations", ids: [3, 4], rehash: [4] } },
          { 4: WORK_OWNER_EDITED },
        ),
      );
      const report = yield* Migrations.runList(app.list);
      expect(report[2]).toEqual({
        module: "work",
        table: "work_migrations",
        adoption: {
          from: "db_migrations",
          adopted: [
            { id: 3, name: "work" },
            { id: 4, name: "work_owner" },
          ],
          rehashed: [{ id: 4, name: "work_owner" }],
        },
        verified: [{ id: 3, name: "work" }],
        backfilled: [{ id: 4, name: "work_owner" }],
        applied: [],
      });
      const work = yield* historyOf("work_migrations");
      expect(work.map((row) => row.sha256)).toEqual([
        old.find((row) => row.migrationId === 3)?.sha256,
        yield* app.digest("packages/work/migrations/0004_work_owner.sql"),
      ]);
      expect(work[1]?.sha256).not.toBe(old.find((row) => row.migrationId === 4)?.sha256);
      expect(yield* historyOf("db_migrations")).toEqual(old);
    }),
  );
});
