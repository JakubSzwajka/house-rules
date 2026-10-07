import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Path } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { Migrations, MigrationsTesting } from "../index.ts";
import { alphaAndBeta, BETA_ENTRY, scratchApp, TRIPS_ITEM, TRIPS_NOTE } from "./scratch-app.ts";

const tableExists = (table: string) =>
  SqlClient.use(
    (sql) => sql<{ exists: boolean }>`select to_regclass(${table}) is not null as exists`,
  ).pipe(Effect.map((rows) => rows[0]?.exists === true));

const historyOf = (table: string) =>
  SqlClient.use(
    (sql) =>
      sql<{
        migrationId: number;
        name: string;
        sha256: string | null;
      }>`select migration_id as "migrationId", name, sha256 from ${sql(table)} order by migration_id`,
  );

const testDatabase = (label: string) =>
  Layer.merge(
    MigrationsTesting.database({
      label,
      client: (url) => PgClient.layer({ url, maxConnections: 4 }),
    }),
    NodeServices.layer,
  );

const options = { excludeTestServices: true, timeout: "30 seconds" } as const;

layer(testDatabase("two"), options)("Migrations, two modules", (it) => {
  it.effect("keeps one history table per module and applies each migration once", () =>
    Effect.gen(function* twoModules() {
      const app = yield* scratchApp(alphaAndBeta);
      const first = yield* Migrations.runList(app.list);
      expect(first).toEqual([
        {
          module: "alpha",
          table: "alpha_migrations",
          verified: [],
          backfilled: [],
          applied: [
            { id: 1, name: "alpha_item" },
            { id: 2, name: "alpha_note" },
          ],
        },
        {
          module: "beta",
          table: "beta_migrations",
          verified: [],
          backfilled: [],
          applied: [{ id: 1, name: "beta_entry" }],
        },
      ]);
      expect(yield* historyOf("alpha_migrations")).toEqual([
        {
          migrationId: 1,
          name: "alpha_item",
          sha256: yield* app.digest("packages/alpha/migrations/0001_alpha_item.sql"),
        },
        {
          migrationId: 2,
          name: "alpha_note",
          sha256: yield* app.digest("packages/alpha/migrations/0002_alpha_note.sql"),
        },
      ]);
      expect((yield* historyOf("beta_migrations")).map((row) => row.name)).toEqual(["beta_entry"]);
      const rows = yield* SqlClient.use((sql) => sql<{ id: number }>`select id from alpha_item`);
      expect(rows).toEqual([{ id: 1 }]);

      const again = yield* Migrations.runList(app.list);
      expect(again.map((module) => module.applied)).toEqual([[], []]);
      expect(again.map((module) => module.verified.length)).toEqual([2, 1]);
      expect(Migrations.formatReport(again)).toEqual([
        "Migrations alpha (alpha_migrations): digest verified 1_alpha_item, 2_alpha_note; digest backfilled none; applied none.",
        "Migrations beta (beta_migrations): digest verified 1_beta_entry; digest backfilled none; applied none.",
      ]);
    }),
  );

  it.effect("refuses a migration file with a bad name", () =>
    Effect.gen(function* badName() {
      const app = yield* scratchApp({
        ...alphaAndBeta,
        "packages/alpha/migrations/0003-bad-name.sql": "select 1;\n",
      });
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error.message).toContain("Module alpha: migration file 0003-bad-name.sql");
    }),
  );
});

layer(testDatabase("identity"), options)("Migrations, a module list built in code", (it) => {
  it.effect("refuses two modules on one history table before any SQL", () =>
    Effect.gen(function* sameTable() {
      const app = yield* scratchApp(alphaAndBeta);
      const path = yield* Path.Path;
      const directory = path.join(path.dirname(app.list), "packages/alpha/migrations");
      const error = yield* Migrations.run([
        { name: "one", directory, table: "shared_migrations" },
        { name: "two", directory, table: "shared_migrations" },
      ]).pipe(Effect.flip);
      expect(error.message).toContain("listed twice");
      expect(yield* tableExists("shared_migrations")).toBe(false);
      expect(yield* tableExists("alpha_item")).toBe(false);
    }),
  );

  it.effect("refuses two modules on one name, and a name that is not a slug", () =>
    Effect.gen(function* sameName() {
      const app = yield* scratchApp(alphaAndBeta);
      const path = yield* Path.Path;
      const directory = path.join(path.dirname(app.list), "packages/alpha/migrations");
      const twice = yield* Migrations.run([
        { name: "one", directory, table: "one_migrations" },
        { name: "one", directory, table: "other_migrations" },
      ]).pipe(Effect.flip);
      expect(twice.message).toContain("listed twice");
      const bad = yield* Migrations.run([
        { name: "NOT A SLUG", directory, table: "bad_migrations" },
      ]).pipe(Effect.flip);
      expect(bad.message).toContain("is not a lowercase slug");
      expect(yield* tableExists("one_migrations")).toBe(false);
      expect(yield* tableExists("other_migrations")).toBe(false);
    }),
  );
});

layer(testDatabase("adopt"), options)("Migrations, adopting a history table", (it) => {
  it.effect("backfills digests, re-runs nothing, and applies only the new files", () =>
    Effect.gen(function* adopts() {
      // The bookkeeping an older single-module runner left behind: no sha256 column.
      yield* SqlClient.use((sql) =>
        Effect.all([
          sql`create table db_migrations (
            migration_id integer primary key,
            created_at timestamptz not null default now(),
            name text not null
          )`,
          sql`create table trips_item (id integer primary key)`,
          sql`insert into db_migrations (migration_id, name) values (1, 'trips_item')`,
        ]),
      );
      const app = yield* scratchApp({
        ...alphaAndBeta,
        "migrations.json": JSON.stringify({
          modules: [
            { workspace: "packages/trips", table: "db_migrations" },
            { package: "@vendor/beta" },
          ],
        }),
        "packages/trips/package.json": JSON.stringify({ name: "@app/trips" }),
        "packages/trips/migrations/0001_trips_item.sql": TRIPS_ITEM,
        "packages/trips/migrations/0002_trips_note.sql": TRIPS_NOTE,
      });
      const report = yield* Migrations.runList(app.list);
      expect(report).toEqual([
        {
          module: "trips",
          table: "db_migrations",
          verified: [],
          backfilled: [{ id: 1, name: "trips_item" }],
          applied: [{ id: 2, name: "trips_note" }],
        },
        {
          module: "beta",
          table: "beta_migrations",
          verified: [],
          backfilled: [],
          applied: [{ id: 1, name: "beta_entry" }],
        },
      ]);
      const history = yield* historyOf("db_migrations");
      expect(history.map((row) => row.sha256)).toEqual([
        yield* app.digest("packages/trips/migrations/0001_trips_item.sql"),
        yield* app.digest("packages/trips/migrations/0002_trips_note.sql"),
      ]);
      expect(yield* tableExists("trips_migrations")).toBe(false);
    }),
  );
});

layer(testDatabase("digest"), options)("Migrations, a digest mismatch", (it) => {
  it.effect("fails and applies nothing in any module", () =>
    Effect.gen(function* allOrNothing() {
      const app = yield* scratchApp(alphaAndBeta);
      yield* Migrations.runList(app.list);

      yield* app.write(
        "packages/alpha/migrations/0003_alpha_extra.sql",
        "create table alpha_extra (id integer);\n",
      );
      yield* app.write(
        "node_modules/@vendor/beta/sql/0001_beta_entry.sql",
        `${BETA_ENTRY}-- edited in place\n`,
      );
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error._tag).toBe("MigrationFailed");
      expect(error.message).toContain("Module beta: applied migration 1_beta_entry was edited");
      expect(yield* tableExists("alpha_extra")).toBe(false);
      expect((yield* historyOf("alpha_migrations")).length).toBe(2);

      yield* app.write("node_modules/@vendor/beta/sql/0001_beta_entry.sql", BETA_ENTRY);
      const report = yield* Migrations.runList(app.list);
      expect(report[0]?.applied).toEqual([{ id: 3, name: "alpha_extra" }]);
      expect(yield* tableExists("alpha_extra")).toBe(true);
    }),
  );
});

layer(testDatabase("broken"), options)("Migrations, a failing migration", (it) => {
  it.effect("rolls back every module", () =>
    Effect.gen(function* failingStatement() {
      const app = yield* scratchApp(alphaAndBeta);
      yield* Migrations.runList(app.list);
      yield* app.write(
        "packages/alpha/migrations/0004_alpha_more.sql",
        "create table alpha_more (id integer);\n",
      );
      yield* app.write(
        "node_modules/@vendor/beta/sql/0002_beta_broken.sql",
        "alter table no_such_table add column x text;\n",
      );
      const error = yield* Migrations.runList(app.list).pipe(Effect.flip);
      expect(error._tag).toBe("MigrationFailed");
      expect(error.message).toContain("Module beta");
      expect(yield* tableExists("alpha_more")).toBe(false);
      expect((yield* historyOf("beta_migrations")).length).toBe(1);
    }),
  );
});

layer(testDatabase("race"), options)("Migrations, two runners at once", (it) => {
  it.effect("queue on the lock, so each migration applies once", () =>
    Effect.gen(function* twoRunners() {
      const app = yield* scratchApp(alphaAndBeta);
      const [left, right] = yield* Effect.all(
        [Migrations.runList(app.list), Migrations.runList(app.list)],
        { concurrency: 2 },
      );
      const applied = [...left, ...right].flatMap((module) => module.applied);
      expect(applied.length).toBe(3);
      expect((yield* historyOf("alpha_migrations")).length).toBe(2);
    }),
  );
});
