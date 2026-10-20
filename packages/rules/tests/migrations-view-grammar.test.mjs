import assert from "node:assert/strict";
import { it } from "node:test";
import { viewDdl } from "../src/sql-views.mjs";
import { run, problemLines } from "./migrations-helpers.mjs";

const root = "packages";
const base = {
  "apps/api/package.json": "{}",
  "packages/orders/package.json": "{}",
  "packages/billing/package.json": "{}",
  "migrations.json": JSON.stringify({
    modules: [{ workspace: `${root}/orders` }, { workspace: `${root}/billing` }],
  }),
  [`${root}/orders/migrations/001_orders.sql`]:
    "create table orders(id text); create view orders_read as select id from orders;",
};
for (const statement of [
  'create view bill_read as select * from"orders";',
  "create view bill_read as table orders;",
  "create view bill_read as select * from bill, (orders cross join bill b);",
  "create view bill_read as select * from orders_read;",
  "create view bill_read as select * from secret.bill;",
  "create view bill_read as select * from missing;",
  "create view bill_read as select nextval('seq');",
  "alter view orders_read rename to changed;",
  "drop view orders_read;",
  "alter materialized view orders_read rename to changed;",
  "drop materialized view orders_read;",
  "alter table orders add column bad text;",
  "drop table orders;",
])
  it(`module view/object ownership rejects: ${statement}`, () => {
    const result = run({
      ...base,
      [`${root}/billing/migrations/001_bill.sql`]: `create table bill(id text); ${statement}`,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stderr, /module list does not name it/);
    assert.match(result.stderr, /view names unknown object|ALTER\/DROP touches|touches "orders"/);
  });
for (const prefix of [
  "create view",
  "create or replace view",
  "create temp view",
  "create temporary view",
  "create materialized view",
  "create materialized view if not exists",
])
  it(`parses supported view DDL: ${prefix}`, () => {
    const statement = `${prefix} bill_read (id) as select id from bill;`;
    assert.deepEqual(
      viewDdl(statement).objects.map(({ name }) => name),
      ["bill_read"],
    );
    const result = run({
      ...base,
      [`${root}/billing/migrations/001_bill.sql`]: `create table bill(id text); ${statement}`,
      "apps/api/src/read-models/bill/adapters/postgres/bill.ts": "sql`select * from bill_read`;",
    });
    assert.equal(result.status, 0, result.stderr);
  });
it("rejects recursive view syntax honestly and never records IF as a view", () => {
  const parsed = viewDdl("create recursive view tree(id) as select id from tree;");
  assert.deepEqual(parsed.objects, []);
  assert.deepEqual(parsed.problems, ["recursive CREATE VIEW is not supported"]);
  assert.deepEqual(
    viewDdl("create materialized view if not exists bill_read as select * from bill;").objects.map(
      ({ name }) => name,
    ),
    ["bill_read"],
  );
});
it("isolates unknown published-view sources from list validation", () => {
  const result = run({
    ...base,
    [`${root}/billing/migrations/001_bill.sql`]:
      "create view bill_read as select * from unknown_source;",
  });
  assert.equal(result.status, 1);
  assert.deepEqual(problemLines(result), [`${root}/billing/migrations/001_bill.sql:1`]);
  assert.match(result.stderr, /SQL names "unknown_source", not a module-owned table or view/);
  assert.doesNotMatch(result.stderr, /migrations\.json:|module list does not name/);
});
