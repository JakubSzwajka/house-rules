import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { migrationChunks } from "../src/migration-chunks.mjs";
import { run } from "./migrations-helpers.mjs";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/migrations/chunk-parity.json", import.meta.url), "utf8"),
);
for (const item of cases)
  it(`checker canonical chunks: ${item.label}`, () => {
    assert.deepEqual(migrationChunks(item.sql), item.chunks);
    const result = run({
      "packages/auth/migrations/0001_orders.sql":
        "create table orders(id text, hidden_value text); create view orders_read as select id from orders;",
      "packages/trips/migrations/0001_bill.sql": item.sql,
    });
    assert.equal(result.status, item.accepts ? 0 : 1, result.stderr);
    if (!item.accepts) assert.ok(result.stderr.includes(item.reason), result.stderr);
  });
