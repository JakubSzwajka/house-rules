import assert from "node:assert/strict";
import { it } from "node:test";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";

const views = new Set(["orders_read"]);
it("leaves unrelated tagged English and SQL-looking text alone", () => {
  assert.deepEqual(
    readModelSqlProblems(
      'import {text} from "./wording.ts"; export const description = text`Select a ${kind} booking`; const example = text`SELECT * FROM private_table`;',
      views,
    ),
    [],
  );
});
it("does not infer database access from declarations or untyped unused wrappers", () => {
  assert.deepEqual(
    readModelSqlProblems(
      'const words = {sql: "Select one"}; const unused = (sql: any) => sql`Select a booking`;',
      views,
    ),
    [],
  );
});
it("separates harmless tagged text from an acquired SQL client in the same source", () => {
  assert.deepEqual(
    readModelSqlProblems(
      'import {SqlClient as C} from "effect/sql"; import {text} from "./wording.ts"; const q = Effect.gen(function*(){ const db = yield* C.SqlClient; const label = text`Select a ${kind} booking`; return db`select * from orders_read`; });',
      views,
    ),
    [],
  );
});
const cases = [
  [
    'import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ let db = yield* C.SqlClient; db = unknownClient; return db`select * from orders_read`; });',
    "unmodified const binding",
  ],
  [
    'import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* C.SqlClient; return helper(db); });',
    "client may be used only as a direct template tag",
  ],
  [
    'import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* C.SqlClient; const alias = db; return alias`select * from orders_read`; });',
    "client may be used only as a direct template tag",
  ],
  [
    'import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* Effect.service(C.SqlClient); return db`select * from orders_read`; });',
    "unrecognized acquisition",
  ],
  [
    'import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* C[key]; return db`select * from orders_read`; });',
    "unrecognized acquisition",
  ],
  [
    "const q = Effect.gen(function*(){ const db = yield* UnknownSql; return db`select * from orders_read`; });",
    "unrecognized acquisition",
  ],
  [
    'import type {SqlClient as DB} from "effect/sql/SqlClient"; const q = (db: DB) => db`select * from orders_read`;',
    "SQL client parameters are unsupported",
  ],
  [
    'import type {SqlClient as Client} from "effect/sql/SqlClient"; type DB = Readonly<Client>; const q = (db: DB) => db`select * from orders_read`;',
    "SQL client parameters are unsupported",
  ],
  [
    'const q = (db: import("effect/sql/SqlClient").SqlClient) => db`select * from orders_read`;',
    "SQL client parameters are unsupported",
  ],
  [
    'import * as C from "effect/sql/SqlClient"; const service = C.SqlClient; helper(service);',
    "services may only be acquired by a direct yield",
  ],
  [
    'export {SqlClient as DB} from "effect/sql/SqlClient";',
    "cannot dynamically import or re-export",
  ],
  [
    'const client = await import("effect/sql/SqlClient");',
    "cannot dynamically import or re-export",
  ],
  ['const client = require("effect/sql/SqlClient");', "cannot dynamically import or re-export"],
  [
    'import Client = require("effect/sql/SqlClient"); const db = Client.SqlClient;',
    "cannot dynamically import or re-export",
  ],
];
for (const [source, reason] of cases)
  it(`rejects SQL provenance: ${source}`, () => {
    const problems = readModelSqlProblems(source, views);
    assert.match(problems.join("\n"), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  });
