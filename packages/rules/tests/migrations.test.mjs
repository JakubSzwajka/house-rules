import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, it } from "node:test";
import {
  AUTH_MIGRATION,
  problemLines,
  run,
  script,
  TRIPS_MIGRATION,
} from "./migrations-helpers.mjs";

describe("house-rules-migrations", () => {
  it("is the package bin", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(manifest.bin["house-rules-migrations"], "bin/migrations.mjs");
    assert.match(fs.readFileSync(script, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });

  it("passes a repo with no SQL", () => {
    const result = run({ "packages/trips/src/index.ts": "export const a = 1;\n" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no SQL migrations found/);
  });

  it("passes modules that keep their foreign keys and SQL to their own tables", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "packages/trips/src/internal/places.ts": [
        'import { sql } from "effect/unstable/sql";',
        "// Not SQL: select * from user in a comment.",
        "export const places = (id: string) =>",
        "  sql`select p.id from place p join trip t on t.id = p.trip_id where t.owner_id = ${id}`;",
        'export const label = "Imported from user settings";',
      ].join("\n"),
      "packages/auth/src/internal/users.ts": 'export const q = "select id from \\"user\\"";\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 table\(s\) owned by 2 package\(s\)/);
  });

  it("fails a cross-module foreign key", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION.replace(
        "owner_id text not null",
        'owner_id text not null references "user" (id)',
      ),
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["packages/trips/migrations/0001_trips.sql:4"]);
    assert.match(result.stderr, /foreign key to "user", a table packages\/auth owns/);
  });

  it("fails module SQL that names another package's table", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "packages/trips/src/internal/owners.ts": [
        "export const owners = () =>",
        "  sql`select t.id, u.id",
        "    from trip t",
        '    join "user" u on u.id = t.owner_id`;',
      ].join("\n"),
      "apps/web/src/server/report.ts": "export const q = `delete from place where id = ${id}`;\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), [
      "apps/web/src/server/report.ts:1",
      "packages/trips/src/internal/owners.ts:4",
    ]);
    assert.match(result.stderr, /SQL names "user", a table packages\/auth owns/);
    assert.match(result.stderr, /SQL names "place", a table packages\/trips owns/);
  });

  it("fails when a plumbing package owns tables a module queries", () => {
    const result = run({
      "packages/db/migrations/0001_init.sql": TRIPS_MIGRATION,
      "packages/trips/src/internal/trips.ts": "export const q = sql`select * from trip`;\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["packages/trips/src/internal/trips.ts:1"]);
    assert.match(result.stderr, /a table packages\/db owns/);
  });

  it("fails a migration that alters another package's table, and a table two packages create", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "packages/trips/migrations/0002_user.sql": 'alter table "user" add column trips int;\n',
      "packages/db/migrations/0001_trip.sql": "create table trip (id text);\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result).sort(), [
      "packages/trips/migrations/0001_trips.sql:2",
      "packages/trips/migrations/0002_user.sql:1",
    ]);
    assert.match(result.stderr, /table "trip" is already created by packages\/db/);
    assert.match(result.stderr, /touches "user", a table packages\/auth owns/);
  });

  it("fails SQL files outside a package's migrations folder", () => {
    const result = run({
      "migrations/0001.sql": "create table a (id text);\n",
      "packages/trips/src/schema.sql": "create table b (id text);\n",
      "packages/trips/migrations/nested/0001.sql": "create table c (id text);\n",
      "packages/trips/node_modules/dep/x.sql": "create table d (id text);\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result).sort(), [
      "migrations/0001.sql:1",
      "packages/trips/migrations/nested/0001.sql:1",
      "packages/trips/src/schema.sql:1",
    ]);
    assert.match(result.stderr, /outside a `<package>\/migrations\/` folder/);
  });

  it("fails comma joins, only, using, truncate, schema prefixes and quoted names", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": `${AUTH_MIGRATION}create table "odd""name" (id text);\n`,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "packages/trips/src/internal/queries.ts": [
        'export const a = sql`select * from trip, "user"`;',
        "export const b = sql`select * from trip t, generate_series(1, 3) g (n), auth.user u`;",
        'export const c = "select * from only \\"user\\"";',
        'export const d = sql`delete from trip using "auth" . "user" where true`;',
        'export const e = sql`truncate only trip, "user"`;',
        'export const f = \'select * from "odd""name"\';',
        'export const g = sql`update only "user" set id = ${id}`;',
      ].join("\n"),
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), [
      "packages/trips/src/internal/queries.ts:1",
      "packages/trips/src/internal/queries.ts:2",
      "packages/trips/src/internal/queries.ts:3",
      "packages/trips/src/internal/queries.ts:4",
      "packages/trips/src/internal/queries.ts:5",
      "packages/trips/src/internal/queries.ts:6",
      "packages/trips/src/internal/queries.ts:7",
    ]);
    assert.match(result.stderr, /SQL names "odd"name", a table packages\/auth owns/);
    assert.doesNotMatch(result.stderr, /"(?:trip|g|generate_series)"/);
  });

  it("does not read SQL comments, string constants or column lists as table names", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": `${TRIPS_MIGRATION}-- Copied from user.\ncomment on table trip is 'Joins from user';\n`,
      "packages/trips/src/internal/queries.ts": [
        "export const a = sql`select 'from user' as message from trip`;",
        "export const b = sql`select * from trip -- join user\n  where id = ${id}`;",
        "export const c = sql`select * from trip /* join user */`;",
        "export const d = sql`select 'it''s from user', E'it\\\\'s from user' from trip`;",
        "export const e = sql`select * from trip where note = '${note} from user'`;",
        'export const f = "select \'from \\"user\\"\' from trip";',
        'export const g = sql`insert into trip (id, "user") values (${id}, 1)`;',
        "export const h = sql`update trip set id = 1, user = 2`;",
        "export const i = sql`select * from trip t order by t.id, user`;",
        "export const j = sql`select * from trip t join place p on p.trip_id = t.id`;",
      ].join("\n"),
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it("skips SQL test data under a package's fixtures or tests folder", () => {
    const result = run({
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/db/fixtures/bad-name/0001-bad-name.sql": 'create table "user" (id int);\n',
      "packages/trips/tests/seed.sql": 'insert into "user" values (1);\n',
      "packages/trips/src/tests/fixtures/rows.sql": "select * from trip;\n",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 table\(s\) owned by 1 package\(s\)/);
  });

  it("still fails SQL test data outside a workspace package", () => {
    const result = run({ "fixtures/seed.sql": "select 1;\n", "tests/seed.sql": "select 1;\n" });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result).sort(), ["fixtures/seed.sql:1", "tests/seed.sql:1"]);
  });

  it("fails a use-case that opens a transaction", () => {
    const result = run({
      "apps/web/src/use-cases/trips/move-trip.ts": [
        'import { SqlClient } from "effect/unstable/sql";',
        "export const run = (sql) => sql.withTransaction(work);",
      ].join("\n"),
      "apps/web/src/use-cases/begin.ts": "export const q = sql`begin`;\n",
      "packages/trips/src/facade.ts": "export const run = (sql) => sql.withTransaction(work);\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result).sort(), [
      "apps/web/src/use-cases/begin.ts:1",
      "apps/web/src/use-cases/trips/move-trip.ts:2",
    ]);
    assert.match(result.stderr, /a use-case opens a transaction/);
  });
});
