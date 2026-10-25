import assert from "node:assert/strict";
import { it } from "node:test";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";

const views = new Set(["orders_read", "bill_read"]);
const query = (sql) =>
  `const q = (id: string, limit: number, actor: {id: string}) => sql\`${sql}\`;`;
const rejected = [
  ['select * from"orders"', '"orders", not a known published view'],
  ['select * from orders_read join"orders" o on true', '"orders", not a known published view'],
  ["select * from orders_read where id in (table orders)", "expected identifier"],
  ["select * from orders_read, (orders cross join bill_read)", "parenthesized table joins"],
  ["select * from secret.orders_read", "schema-qualified"],
  ['select * from "secret"."orders_read"', "schema-qualified"],
  ["select nextval('s')", "functions are not allowed"],
  ["select set_config('role','x',false)", "SQL reserves set_config"],
  ["select pg_read_file('/etc/passwd')", "functions are not allowed"],
  ["select dblink_exec('x','drop table y')", "functions are not allowed"],
  [
    "select * from orders_read where id = (select id from orders)",
    '"orders", not a known published view',
  ],
  ["with x as (delete from orders_read returning *) select * from x", "expected select"],
  ["with x as (select * from orders) select * from x", '"orders", not a known published view'],
  ["with recursive x as (select 1) select * from x", "recursive WITH"],
  ["select * from orders_read; select 1", "only one SELECT"],
  ["select * from orders_read for no key update", "only one SELECT"],
  ["select * from orders_read for key share", "only one SELECT"],
  ["select * into orders from orders_read", "only one SELECT"],
  ["select * from orders_read tablesample system(10)", "only one SELECT"],
  ["select * from orders_read order by ${id}", "not SQL structure"],
  ["select * from ${id}", "expected identifier"],
  ["select * from orders_read where id = '${id}'", "unquoted value parameter"],
  ["select * from orders_read -- ${id}", "unquoted value parameter"],
  ["select * from orders_read ${id}", "only one SELECT"],
  ['select U&"orders" from orders_read', "only one SELECT"],
  ["select * from orders_read /* unclosed", "unclosed SQL comment"],
  ["select * from orders_read where id = 'unclosed", "unclosed SQL quote"],
  ["select * from missing_read", '"missing_read", not a known published view'],
];
for (const [sql, reason] of rejected)
  it(`rejects SQL grammar: ${sql}`, () => {
    const problems = readModelSqlProblems(query(sql), views);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  });
for (const sql of [
  'select * from"orders_read"',
  "select * from orders_read where id=${id}",
  "select * from orders_read where id<>${id}",
  "select * from orders_read where id=-1",
  "select * from orders_read where id=+1",
  "select * from orders_read where id in(${id}) limit ${limit}",
  "select o.id, b.id from orders_read o left join bill_read b on b.id = o.id where o.id = ${actor.id} order by o.id limit ${limit}",
  "with x as (select id from orders_read where id = ${id}) select * from x",
  "select * from orders_read where id in (select id from bill_read)",
  "select * from orders_read where id in (${id}, 'two')",
  "select * from orders_read where id = $$ ; delete from orders $$",
  "select * from orders_read where id = 'delete from orders;' /* nested /* from orders */ comment */;",
])
  it(`accepts supported SQL: ${sql}`, () =>
    assert.deepEqual(readModelSqlProblems(query(sql), views), []));

for (const source of [
  'const q = conn.executeValues("sel"+"ect * from orders", []);',
  "const q = conn.executeStream(text, []);",
  "const q = conn.executeValuesUnprepared(text, []);",
  "helper(sql);",
  'Reflect.apply(Reflect.get(sql, "un"+"safe"), sql, [text]);',
  "const alias = sql; alias`select * from orders_read`;",
  "const {unsafe: run} = sql; run(text);",
  "sql[text](query);",
  "const f = Statement.fragment(parts); sql`select * from orders_read where id = ${f}`;",
  'const f = Statement.identifier("id"); sql`select * from orders_read where id = ${f}`;',
  'import {fragment} from "effect/sql/Statement"; const f = fragment(parts);',
  'import {SqlClient as C} from "effect/sql"; helper(C.SqlClient);',
  'import {SqlClient as C} from "effect/sql"; C.SqlClient.use(db => db`select * from orders_read`);',
  'import {value} from "./unknown.ts"; sql`select * from orders_read where id = ${value}`;',
  "const q = (value: unknown) => sql`select * from orders_read where id = ${value}`;",
  "const q = (value: Statement) => sql`select * from orders_read where id = ${value}`;",
  "const q = (value: {id: unknown}) => sql`select * from orders_read where id = ${value.id}`;",
  "type Actor = Statement; const q = (value: Actor) => sql`select * from orders_read where id = ${value.id}`;",
])
  it(`rejects SQL source escape: ${source}`, () =>
    assert.notDeepEqual(readModelSqlProblems(source, views), []));

it("accepts scalar domain identity parameters only from the owning kit", () => {
  assert.deepEqual(
    readModelSqlProblems(
      'import type {Actor as Person, ActorId as Id} from "@house-rules/domain"; const q = (actor: Person, id: Id) => sql`select * from orders_read where id = ${actor.id} or id = ${id}`;',
      views,
    ),
    [],
  );
});
it("accepts actual client acquisition and scalar constants, without English false positives", () => {
  assert.deepEqual(
    readModelSqlProblems(
      `import {SqlClient as C} from "effect/sql";
    const q = (id: string) => Effect.gen(function*() { const db = yield* C.SqlClient;
      const fallback = "fixed"; return db\`select * from orders_read where id = \${id} or id = \${fallback}\`; });
    export const description = "Select the caller's bookings.";
    export const wording = \`Select a \${kind} booking\`;`,
      views,
    ),
    [],
  );
});
