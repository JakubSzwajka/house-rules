import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { expect } from "@effect/vitest";
import { Effect, Layer, Path } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { Migrations, MigrationsTesting } from "../index.ts";
import { BETA_ENTRY, scratchApp, type Tree } from "./scratch-app.ts";

export const FILES = {
  1: ["log", "create table log_entry (id integer primary key);\n"],
  2: ["people", "create table person (id integer primary key);\n"],
  3: ["work", "create table task (id integer primary key, owner integer);\n"],
  4: [
    "work_owner",
    "alter table task add constraint task_owner foreign key (owner) references person (id);\n",
  ],
  5: ["people_name", "alter table person add column name text;\n"],
} as const;
export type Id = keyof typeof FILES;
const fileName = (id: Id) => `000${id}_${FILES[id][0]}.sql`;

export const OWNERS: Readonly<Record<string, ReadonlyArray<Id>>> = {
  log: [1],
  people: [2, 5],
  work: [3, 4],
};

export const legacyTree: Tree = Object.fromEntries(
  ([1, 2, 3, 4, 5] as const).map((id) => [`legacy/${fileName(id)}`, FILES[id][1]]),
);

type Adopt = Readonly<{ from: string; ids: ReadonlyArray<number>; rehash?: ReadonlyArray<number> }>;

export const moduleTree = (
  adopt: Readonly<Record<string, Adopt>>,
  edits: Readonly<Partial<Record<Id, string>>> = {},
  extra: Tree = {},
): Tree => ({
  "migrations.json": JSON.stringify({
    modules: [
      ...Object.keys(OWNERS).map((name) => ({
        workspace: `packages/${name}`,
        ...(adopt[name] === undefined ? {} : { adopt: adopt[name] }),
      })),
      { package: "@vendor/beta" },
    ],
  }),
  ...Object.fromEntries(
    Object.entries(OWNERS).flatMap(([name, ids]) => [
      [`packages/${name}/package.json`, JSON.stringify({ name: `@app/${name}` })],
      ...ids.map((id) => [
        `packages/${name}/migrations/${fileName(id)}`,
        edits[id] ?? FILES[id][1],
      ]),
    ]),
  ),
  "node_modules/@vendor/beta/package.json": JSON.stringify({
    name: "@vendor/beta",
    houseRules: { migrations: "sql" },
  }),
  "node_modules/@vendor/beta/sql/0001_beta_entry.sql": BETA_ENTRY,
  ...extra,
});

export const ADOPT_ALL = {
  log: { from: "db_migrations", ids: [1] },
  people: { from: "db_migrations", ids: [2, 5] },
  work: { from: "db_migrations", ids: [3, 4] },
} as const;

export const WORK_OWNER_EDITED = "alter table task add column owner_checked boolean;\n";

export const historyOf = (table: string) =>
  SqlClient.use(
    (sql) =>
      sql<{
        migrationId: number;
        createdAt: string;
        name: string;
        sha256: string | null;
      }>`select migration_id as "migrationId", created_at::text as "createdAt", name, sha256
        from ${sql(table)} order by migration_id`,
  );

export const tableExists = (table: string) =>
  SqlClient.use(
    (sql) => sql<{ exists: boolean }>`select to_regclass(${table}) is not null as exists`,
  ).pipe(Effect.map((rows) => rows[0]?.exists === true));

export const MODULE_TABLES = [
  "log_migrations",
  "people_migrations",
  "work_migrations",
  "beta_migrations",
];

export const noneWritten = Effect.fnUntraced(function* noneWritten() {
  for (const table of [...MODULE_TABLES, "beta_entry", "task_extra"]) {
    expect(yield* tableExists(table)).toBe(false);
  }
});

export const legacyApp = Effect.fnUntraced(function* legacyApp(tree: Tree) {
  const app = yield* scratchApp({ ...legacyTree, ...tree });
  const path = yield* Path.Path;
  const directory = path.join(path.dirname(app.list), "legacy");
  // The old app's single runner: every file in one folder, on db_migrations.
  yield* Migrations.run([{ name: "legacy", directory, table: "db_migrations" }]);
  return { app, old: yield* historyOf("db_migrations") };
});

export const testDatabase = (label: string, maxConnections = 4) =>
  Layer.merge(
    MigrationsTesting.database({
      label,
      client: (url) => PgClient.layer({ url, maxConnections }),
    }),
    NodeServices.layer,
  );

export const options = { excludeTestServices: true, timeout: "30 seconds" } as const;

export const oldRunner = (during: Effect.Effect<void, SqlError> = Effect.void) =>
  SqlClient.use((sql) =>
    sql.withTransaction(
      Effect.gen(function* oldRun() {
        yield* sql`select pg_advisory_xact_lock(hashtextextended('db_migrations', 0))`;
        yield* during;
        const rows = yield* sql<{ migrationId: number }>`select migration_id as "migrationId"
          from db_migrations order by migration_id`;
        return rows.map((row) => row.migrationId);
      }),
    ),
  );

export const waitForLockWaiters = (minimum: number) =>
  Effect.gen(function* waiting() {
    const sql = yield* SqlClient;
    for (;;) {
      const [row] = yield* sql<{ waiting: number }>`select count(*)::int as waiting
        from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if ((row?.waiting ?? 0) >= minimum) return;
      yield* Effect.yieldNow;
    }
  }).pipe(Effect.timeout("15 seconds"));
