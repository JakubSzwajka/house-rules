import assert from "node:assert/strict";
import { it } from "node:test";
import { run, problemLines } from "./migrations-helpers.mjs";

it("rejects an unlisted app folder independently of location validation", () => {
  const result = run({
    "apps/api/package.json": "{}",
    "apps/api/src/modules/orders/migrations/001_orders.sql": "create table orders(id text);",
    "migrations.json": '{"modules":[]}',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(problemLines(result), [
    "apps/api/src/modules/orders/migrations/001_orders.sql:1",
  ]);
  assert.match(result.stderr, /outside a `<package>\/migrations\/` folder/);
  assert.doesNotMatch(result.stderr, /folder must be below/);
});
it("does not discover folder modules or read models inside shared packages", () => {
  const result = run({
    "packages/trips/src/read-models/screen/migrations/fixture.txt": "not a migration",
    "packages/trips/src/read-models/screen/subject/message.ts":
      'export const message = "Select a booking";',
    "packages/trips/src/modules/orders/migrations/fixture.txt": "not a migration",
    "migrations.json": '{"modules":[]}',
  });
  assert.equal(result.status, 0, result.stderr);
});
for (const area of [
  "features/show/handler.ts",
  "modules/orders/facade.ts",
  "read-models/report/facade.ts",
  "composition/seed.ts",
  "scripts/seed.ts",
  "modules/orders/scripts/seed.ts",
  "features/show/scripts/seed.ts",
])
  it(`production app code cannot open a unit: ${area}`, () => {
    const result = run({
      "apps/api/package.json": "{}",
      [`apps/api/src/${area}`]: "UnitOfWork.atomic(work);",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), [`apps/api/src/${area}:1`]);
    assert.match(result.stderr, /opens a unit of work/);
  });
it("tests, scripts and kit entry runtime can open units", () => {
  const result = run({
    "apps/api/package.json": "{}",
    "apps/api/src/features/show/tests/handler.test.ts": "UnitOfWork.atomic(work);",
    "apps/api/src/modules/orders/tests/facade.test.ts": "UnitOfWork.atomic(work);",
    "apps/api/src/read-models/report/tests/facade.test.ts": "UnitOfWork.atomic(work);",
    "apps/api/scripts/seed.ts": "UnitOfWork.atomic(work);",
    "scripts/seed.ts": "UnitOfWork.atomic(work);",
    "packages/trips/scripts/seed.ts": "UnitOfWork.atomic(work);",
    "packages/domain/package.json": '{"name":"@house-rules/domain"}',
    "packages/domain/src/unit-of-work/adapter.ts": "UnitOfWork.atomic(work);",
    "packages/application/package.json": '{"name":"@house-rules/application"}',
    "packages/application/src/entry/run-entry.ts": "UnitOfWork.atomic(work);",
  });
  assert.equal(result.status, 0, result.stderr);
});
for (const file of ["src/scripts/seed.ts", "src/trip/scripts/seed.ts"])
  it(`production package code cannot open a unit: ${file}`, () => {
    const result = run({ [`packages/trips/${file}`]: "UnitOfWork.atomic(work);" });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), [`packages/trips/${file}:1`]);
    assert.match(result.stderr, /opens a unit of work/);
  });
