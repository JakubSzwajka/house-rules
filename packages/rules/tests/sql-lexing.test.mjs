import assert from "node:assert/strict";
import { it } from "node:test";
import { sqlTokens } from "../src/sql-tokens.mjs";
import { selectProblems } from "../src/sql-select.mjs";
import { viewDdl } from "../src/sql-views.mjs";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";
import { run } from "./migrations-helpers.mjs";

const root = "packages";
const base = (sql, extra = {}) => ({
  "apps/api/package.json": "{}",
  "packages/orders/package.json": "{}",
  "packages/billing/package.json": "{}",
  "migrations.json": JSON.stringify({
    modules: [{ workspace: `${root}/orders` }, { workspace: `${root}/billing` }],
  }),
  [`${root}/orders/migrations/001_orders.sql`]:
    "create table orders(id text, secret text); create view orders_read as select id from orders;",
  [`${root}/billing/migrations/001_bill.sql`]: sql,
  ...extra,
});
const source = (query) =>
  'import { SqlClient } from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* SqlClient.SqlClient; return db`' +
  query +
  "`; });";
for (const literal of ["text ')'", "'x'\n')'"]) {
  const query = `select (select secret from orders_read a join orders_read b on a.id = b.id or a.id = ${literal} , orders where orders.id = '('\n'z')`;
  it(`rejects the real PG private-column query: ${literal}`, () => {
    assert.equal(selectProblems(query, new Set(["orders_read"])).length, 1);
    assert.equal(readModelSqlProblems(source(query), new Set(["orders_read"])).length, 1);
    const model = run(
      base("create table bill(id text);", {
        "apps/api/src/read-models/mine/adapters/postgres/mine.ts": source(query),
      }),
      { list: false },
    );
    assert.equal(model.status, 1, model.stderr);
    assert.match(model.stderr, /read-model SQL/);
    const view = run(
      base(
        `create table bill(id text); create view bill_read(s) as ${query.replaceAll("orders_read", "bill")};`,
      ),
      { list: false },
    );
    assert.equal(view.status, 1, view.stderr);
    assert.match(view.stderr, /view names unknown object or unsupported SQL/);
  });
}
for (const value of [")", "(", ",", "from", "where", "or", "="]) {
  it(`does not treat string content as syntax: ${value}`, () => {
    assert.deepEqual(
      selectProblems(`select '${value}' from orders_read`, new Set(["orders_read"])),
      [],
    );
    assert.equal(
      selectProblems(`select 1 '${value}' 2 from orders_read`, new Set(["orders_read"])).length,
      1,
    );
  });
}
for (const action of ["drop view orders_read", "alter view orders_read rename to gone"]) {
  it(`sees foreign DDL after an escaped string: ${action}`, () => {
    const sql = String.raw`create table bill(id text default e'\''); ${action}; --');`;
    const parsed = viewDdl(sql);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(
      parsed.changes.map(({ name }) => name),
      ["orders_read"],
    );
    const result = run(base(sql), { list: false });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /ALTER\/DROP touches "orders_read"/);
  });
}
it("lexes standard, escaped, dollar-tagged and quoted literals with nested comments", () => {
  const sql = String.raw`'a''b' E'a\'b\\c' $tag$'); drop view foreign_view;$tag$ "Case" "a""b" -- ignored
/* outer /* inner */ end */ select`;
  assert.deepEqual(
    sqlTokens(sql).map(({ kind, value }) => [kind, value]),
    [
      ["string", "a'b"],
      ["string", "a'b\\c"],
      ["string", "'); drop view foreign_view;"],
      ["identifier", "Case"],
      ["identifier", 'a"b'],
      ["word", "select"],
    ],
  );
});
for (const op of ["@>", "@@", "#>>", "->>", "?|", "?&", "<@", "||"]) {
  it(`accepts module operator ${op} but rejects unsupported SELECT without a crash`, () => {
    const sql = `create table bill(data jsonb check (data ${op} '{}'));`;
    const result = run(base(sql), { list: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      selectProblems(`select data ${op} '{}' from orders_read`, new Set(["orders_read"])).length,
      1,
    );
    assert.deepEqual(
      sqlTokens(op).map(({ kind, value }) => [kind, value]),
      [["symbol", op]],
    );
  });
}
for (const sql of [
  "select 'unclosed",
  "select E'unclosed\\",
  "select $tag$unclosed",
  "select /* unclosed",
  "select \\",
]) {
  it(`fails closed on unknown or unclosed lexical input: ${sql}`, () => {
    assert.equal(selectProblems(sql, new Set()).length, 1);
    assert.equal(viewDdl(sql).problems.length, 1);
    const result = run(base(sql), { list: false });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /problem\(s\) with module-owned SQL/);
    assert.doesNotMatch(result.stderr, /at sqlTokens|at foreignKeyReferences|Error:/);
  });
}
for (const sql of [
  "create table bill(id text); alter table only bill add column note text;",
  'create table "Bill"(id text); create view bv as select id from "Bill";',
  ...["", "local ", "cascaded "].map(
    (modifier) =>
      `create table bill(id text); create view bv as select id from bill with ${modifier}check option;`,
  ),
]) {
  it(`accepts supported own-table/view syntax: ${sql}`, () => {
    const result = run(base(sql), { list: false });
    assert.equal(result.status, 0, result.stderr);
  });
}
