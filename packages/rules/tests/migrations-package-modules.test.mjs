import assert from "node:assert/strict";
import { it } from "node:test";
import { run } from "./migrations-helpers.mjs";

it("rejects a removed folder location, even beside a package location", () => {
  for (const entry of [
    { folder: "local/orders" },
    { folder: "local/orders", workspace: "packages/orders" },
  ]) {
    const result = run({ "migrations.json": JSON.stringify({ modules: [entry] }) });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /"folder" locations are not supported; domain modules are packages/,
    );
  }
});
it("listed packages own SQL, publish views and retain unit checks", () => {
  const files = {
    "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/orders" }] }),
    "packages/orders/migrations/001_orders.sql":
      "create table orders(id text); create view orders_read as select * from orders;",
    "packages/orders/src/adapters/postgres/orders.ts": "const rows = sql`select * from orders`;",
    "apps/api/package.json": "{}",
    "packages/orders/package.json": "{}",
    "packages/billing/package.json": "{}",
    "apps/api/src/read-models/orders/adapters/postgres/orders.ts":
      "const rows = sql`select * from orders_read`;",
  };
  const good = run(files);
  assert.equal(good.status, 0, good.stderr);
  const bad = run({ ...files, "packages/orders/src/facade.ts": "UnitOfWork.atomic(work);" });
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /module opens a unit/);
});
it("package module owns SQL and cannot open a unit", () => {
  const root = "packages";
  const result = run({
    "apps/api/package.json": "{}",
    "packages/orders/package.json": "{}",
    "packages/billing/package.json": "{}",
    "migrations.json": JSON.stringify({
      modules: [{ workspace: `${root}/orders` }, { workspace: `${root}/billing` }],
    }),
    [`${root}/orders/migrations/001_orders.sql`]: "create table orders(id text);",
    [`${root}/billing/migrations/001_bill.sql`]:
      "create table bill(id text references orders); create view bill_read as select * from orders;",
    [`${root}/billing/src/adapters/postgres/bill.ts`]:
      "const work = sql`select * from orders`; UnitOfWork.atomic(work);",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /foreign key/);
  assert.match(result.stderr, /touches "orders"/);
  assert.match(result.stderr, /module opens a unit/);
});
