import assert from "node:assert/strict";
import { it } from "node:test";
import { run, problemLines } from "./migrations-helpers.mjs";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";

const file = "apps/web/src/read-models/report/adapters/postgres/report.ts";
const base = {
  "packages/trips/migrations/001_trip.sql":
    "create table trip(id text); create view trip_read as select id from trip;",
  "packages/db/package.json": '{"name":"@acme/db","exports":{".":"./src/index.ts"}}',
  "packages/db/src/index.ts": 'export { Database } from "./database.ts";',
  "packages/db/src/database.ts": 'export { SqlClient as Database } from "effect/sql";',
};
for (const query of ["select * from trip", "select * from trip_read"]) {
  it(`traces a workspace-reexported SQL service: ${query}`, () => {
    const result = run({
      ...base,
      [file]: `import { Database as DB } from "@acme/db"; const q = Effect.gen(function*(){ const db = yield* DB.SqlClient; return db\`${query}\`; });`,
    });
    assert.equal(result.status, query.endsWith("trip_read") ? 0 : 1, result.stderr);
    if (!query.endsWith("trip_read")) {
      assert.deepEqual(problemLines(result), [`${file}:1`]);
      assert.match(result.stderr, /"trip", not a known published view/);
    }
  });
  it(`traces an exported client tag through workspace and star barrels: ${query}`, () => {
    const result = run({
      ...base,
      "packages/db/src/index.ts": 'export * from "./database.ts";',
      "packages/db/src/database.ts":
        'import type { SqlClient } from "effect/sql/SqlClient"; export declare const query: SqlClient;',
      [file]: `import { query as read } from "@acme/db"; const q = read\`${query}\`;`,
    });
    assert.equal(result.status, query.endsWith("trip_read") ? 0 : 1, result.stderr);
    if (!query.endsWith("trip_read"))
      assert.match(result.stderr, /"trip", not a known published view/);
  });
}
it("does not treat an unrelated workspace tag named sql as a client", () => {
  const result = run({
    ...base,
    "packages/db/src/index.ts": "export const sql = (parts: unknown) => parts;",
    [file]: 'import { sql } from "@acme/db"; export const description = sql`select * from trip`;',
  });
  assert.equal(result.status, 0, result.stderr);
});
it("rejects destructured unknown yields without guessing from the variable name", () => {
  for (const pattern of ["[read]", "{query: read}"]) {
    const problems = readModelSqlProblems(
      `import { Db } from "@acme/db"; const q = Effect.gen(function*(){ const ${pattern} = yield* Effect.all([Db]); return read\`select * from trip\`; });`,
      new Set(["trip_read"]),
    );
    assert.deepEqual(problems, [
      "read-model SQL tag has an unrecognized acquisition; use a direct imported SQL service yield.",
    ]);
  }
});
it("does not claim that unrelated callback parameters are proven SQL clients", () => {
  assert.deepEqual(
    readModelSqlProblems(
      'import { Db } from "@acme/wording"; const q = Effect.flatMap(Db, (sql) => sql`Select a booking`);',
      new Set(),
    ),
    [],
  );
});
it("rejects callbacks on a workspace-reexported actual SQL service", () => {
  const result = run({
    ...base,
    [file]:
      'import { Database as DB } from "@acme/db"; export const q = Effect.flatMap(DB.SqlClient, (sql) => sql`select * from trip`);',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /services may only be acquired by a direct yield/);
});
