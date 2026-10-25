import assert from "node:assert/strict";
import { it } from "node:test";
import { run } from "./migrations-helpers.mjs";

const base = {
  "apps/api/package.json": "{}",
  "packages/orders/package.json": "{}",
  "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/orders" }] }),
  "packages/orders/migrations/001_orders.sql":
    "create table orders(id text); create view orders_read as select id from orders;",
};
const cases = [
  [
    "known published view",
    "const rows = sql`select * from orders_read where id = ${actor.id}`;",
    true,
  ],
  [
    "known view alias and limit",
    "const rows = sql`select o.id from orders_read o where o.id = ${id} order by o.id limit ${limit}`;",
    true,
  ],
  ["private table", "const rows = sql`select * from orders`;", false],
  ["comma-listed private table", "const rows = sql`select * from orders_read r, orders o`;", false],
  [
    "unknown joined view",
    "const rows = sql`select * from orders_read r join unknown_read u on r.id = u.id`;",
    false,
  ],
  ["write", "const rows = sql`delete from orders_read`;", false],
  ["dynamic identifier", "const rows = sql`select * from ${table}`;", false],
  ["dynamic fragment", "const rows = sql`select * from orders_read ${filter}`;", false],
  ["unsafe raw", "const rows = sql.unsafe(query);", false],
  ["computed client method", "const rows = sql[method](query);", false],
  [
    "yielded client alias method",
    "const run = Effect.gen(function* () { const db = yield* SqlClient; const alias = db; return alias[method](query); });",
    false,
  ],
  ["extracted client method", "const { unsafe: run } = sql; run(query);", false],
  ["untagged query string", 'const query = "select * from orders_read"; database(query);', false],
  ["untagged dynamic template", "const query = `select * from ${view}`; database(query);", false],
  ["unknown view", "const rows = sql`select * from unknown_read`;", false],
  [
    "extra statement",
    "const rows = sql`select * from orders_read; select * from orders_read`;",
    false,
  ],
  ["unreadable source", "const rows = sql`select * from orders_read` @@@;", false],
];
for (const [name, source, accepts] of cases)
  it(`read model: ${name}`, () => {
    const result = run({
      ...base,
      "apps/api/src/read-models/orders/adapters/postgres/orders.ts": `export const query = (actor: {id: string}, id: string, limit: number) => { ${source} };`,
    });
    assert.equal(result.status === 0, accepts, result.stderr);
  });
it("read models cannot own migrations", () => {
  const result = run({
    ...base,
    "apps/api/src/read-models/orders/migrations/001.sql": "select 1;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /read model has no migrations/);
});
