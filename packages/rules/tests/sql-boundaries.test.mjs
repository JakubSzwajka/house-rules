import assert from "node:assert/strict";
import { it } from "node:test";
import { sqlTokens } from "../src/sql-tokens.mjs";
import { selectProblems } from "../src/sql-select.mjs";
import { viewDdl } from "../src/sql-views.mjs";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";
import { run } from "./migrations-helpers.mjs";

const diagnostic = /non-ASCII SQL outside string or quoted identifier/;
const root = "packages";
const source = (query) =>
  'import { SqlClient } from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* SqlClient.SqlClient; return db`' +
  query +
  "`; });";
const fixture = (ddl, query) => ({
  "apps/api/package.json": "{}",
  "packages/orders/package.json": "{}",
  "packages/billing/package.json": "{}",
  "migrations.json": JSON.stringify({
    modules: [{ workspace: `${root}/orders` }, { workspace: `${root}/billing` }],
  }),
  [`${root}/orders/migrations/001_orders.sql`]:
    "create table orders(id text, hidden_value text); create view orders_read as select id from orders;",
  [`${root}/billing/migrations/001_bill.sql`]: ddl,
  ...(query ? { "apps/api/src/read-models/mine/adapters/postgres/mine.ts": source(query) } : {}),
});
for (const [name, character] of [
  ["NBSP", "\u00a0"],
  ["EM SPACE", "\u2003"],
  ["BOM", "\ufeff"],
  ["Cyrillic a", "\u0430"],
]) {
  const query = `with t ("${character}$a$", k) as (select id, id from orders_read) select k = ${character}$a$ , (select hidden_value from orders) ${character}$a$ from t`;
  const view = `create table bill(id text); create view bill_read(k,z) as ${query.replaceAll("orders_read", "bill")};`;
  const ddl = `create table bill(id text); alter table bill rename to ${character}$a$; drop view orders_read; alter table ${character}$a$ rename to bill;`;
  for (const [shape, sql] of [
    ["q1", query],
    ["d1", ddl],
    ["v1", view],
  ]) {
    it(`rejects ${name} ${shape} with an explicit boundary diagnostic`, () => {
      const problems =
        shape === "q1" ? selectProblems(sql, new Set(["orders_read"])) : viewDdl(sql).problems;
      assert.equal(problems.length, 1);
      assert.match(problems[0], diagnostic);
      if (shape === "q1") {
        const acquired = readModelSqlProblems(source(sql), new Set(["orders_read"]));
        assert.equal(acquired.length, 1);
        assert.match(acquired[0], diagnostic);
      }
      const result = run(
        fixture(
          shape === "q1" ? "create table bill(id text);" : sql,
          shape === "q1" ? sql : undefined,
        ),
        { list: false },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, diagnostic);
    });
  }
  it(`allows ${name} inside strings and quoted identifiers only`, () => {
    const query = `select '${character}', "${character}" from orders_read`;
    assert.deepEqual(selectProblems(query, new Set(["orders_read"])), []);
    const result = run(
      fixture(
        `create table bill("${character}" text); create view bill_read as select "${character}", '${character}' as note from bill;`,
        query,
      ),
      { list: false },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      selectProblems(`select id from orders_read -- ${character}`, new Set(["orders_read"]))[0],
      diagnostic,
    );
    assert.match(
      viewDdl(`/* ${character} */ create view bv as select id from bill`).problems[0],
      diagnostic,
    );
  });
  it(`keeps ${name} and a following dollar tag inside an identifier`, () => {
    assert.deepEqual(
      sqlTokens(`${character}$a$`).map(({ kind, value }) => [kind, value]),
      [["word", `${character}$a$`]],
    );
  });
}
it("uses only PostgreSQL ASCII whitespace and CR ends line comments", () => {
  assert.deepEqual(
    sqlTokens(" \t\n\r\f\vselect -- note\r id").map(({ kind, value }) => [kind, value]),
    [
      ["word", "select"],
      ["word", "id"],
    ],
  );
  assert.deepEqual(
    sqlTokens("foo$a$ bar$a$").map(({ kind, value }) => [kind, value]),
    [
      ["word", "foo$a$"],
      ["word", "bar$a$"],
    ],
  );
});
it("preserves boundaries of U&, B, X, N and E literal prefixes", () => {
  assert.deepEqual(
    sqlTokens(String.raw`U&'a\0062' U&"bill" B'01' X'ff' N'a''b' E'a\'b'`).map(
      ({ kind, value }) => [kind, value],
    ),
    [
      ["string", String.raw`a\0062`],
      ["identifier", "bill"],
      ["string", "01"],
      ["string", "ff"],
      ["string", "a'b"],
      ["string", "a'b"],
    ],
  );
  for (const prefix of ["U&", "B", "X", "N", "E"]) {
    const parsed = viewDdl(`select ${prefix}'fixed_marker'; drop view orders_read;`);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(
      parsed.changes.map(({ name }) => name),
      ["orders_read"],
    );
  }
  assert.throws(
    () => sqlTokens(String.raw`U&"b\0069ll"`),
    /Unicode-escaped SQL identifier is not supported/,
  );
  assert.deepEqual(
    selectProblems(
      "select U&'fixed_marker', N'fixed_marker' from orders_read",
      new Set(["orders_read"]),
    ),
    [],
  );
});
