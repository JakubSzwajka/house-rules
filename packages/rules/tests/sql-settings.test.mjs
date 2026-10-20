import assert from "node:assert/strict";
import { it } from "node:test";
import { selectProblems } from "../src/sql-select.mjs";
import { run } from "./migrations-helpers.mjs";

const settings = [
  "SET standard_conforming_strings = off",
  'SET LOCAL "standard_conforming_strings" = off',
  "SeT SESSION BACKSLASH_QUOTE = on",
  'RESET "backslash_quote"',
  'ALTER DATABASE "db" SET "standard_conforming_strings" TO off',
  'ALTER ROLE "role" IN DATABASE "db" SET BACKSLASH_QUOTE TO on',
  "ALTER SYSTEM SET standard_conforming_strings = off",
  "select set_config('standard_conforming_strings', 'off', true)",
  "select pg_catalog.\"set_config\"($x$BACKSLASH_QUOTE$x$, 'on', true)",
  "select set_config(setting_name, 'off', true)",
  "select set_config('application_' || 'name', 'off', true)",
  String.raw`select set_config(E'\x73tandard_conforming_strings', 'off', true)`,
];
for (const statement of settings)
  for (const form of ["same", "chunk", "file"])
    it(`rejects lexical setting ${form}: ${statement}`, () => {
      const files = { "packages/trips/migrations/0001_bill.sql": "create table bill(id text);\n" };
      if (form === "file") files["packages/trips/migrations/0002_mode.sql"] = `${statement};`;
      else
        files["packages/trips/migrations/0001_bill.sql"] +=
          `${form === "chunk" ? "--> statement-breakpoint\n" : ""}${statement};`;
      const result = run(files);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /standard_conforming_strings|backslash_quote/u);
      assert.notDeepEqual(selectProblems(statement, new Set(["bill_read"])), []);
    });
for (const statement of [
  "set application_name = 'example'",
  "RESET ALL",
  "select 'SETTING example = off'",
  "-- unrelated comment\nselect 1",
])
  it(`allows SQL without reserved words: ${statement}`, () => {
    const result = run({
      "packages/trips/migrations/0001_bill.sql": `create table bill(id text); ${statement};`,
    });
    assert.equal(result.status, 0, result.stderr);
  });
for (const prefix of ["", "N", "n"])
  it(`rejects ambiguous backslash ${prefix} strings in SELECT and view DDL`, () => {
    const query = String.raw`select ${prefix}'\'' , (select hidden_value from orders) as b, ' as c from bill_read -- '`;
    assert.match(
      selectProblems(query, new Set(["bill_read"])).join("\n"),
      /use E strings or dollar quotes/u,
    );
    const result = run({
      "packages/trips/migrations/0001_bill.sql": `create table bill(id text); create view bill_read as ${query};`,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /use E strings or dollar quotes/u);
  });
for (const literal of [String.raw`E'back\\slash;quote'`, String.raw`$tag$back\slash;quote$tag$`])
  it(`preserves explicit string boundaries: ${literal}`, () => {
    assert.deepEqual(
      selectProblems(`select ${literal} from bill_read`, new Set(["bill_read"])),
      [],
    );
    const result = run({
      "packages/trips/migrations/0001_bill.sql": `create table bill(id text); create view bill_read as select ${literal} from bill;`,
    });
    assert.equal(result.status, 0, result.stderr);
  });
