import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { problemLines, run } from "./migrations-helpers.mjs";

// How house-rules-migrations tells a transaction start in SQL text from UI copy and PL/pgSQL.
describe("house-rules-migrations, begin in SQL text", () => {
  it("fails begin in SQL text in any case, after comments, and in any statement", () => {
    const cases = [
      "export const q = sql`BeGiN`;",
      "export const q = sql`Begin transaction`;",
      "export const q = sql`begin; select 1`;",
      "export const q = sql`begin /* unit */`;",
      "export const q = sql`/* unit */ begin`;",
      "export const q = sql`\n  -- open the unit\n  BEGIN ISOLATION LEVEL SERIALIZABLE`;",
      "export const q = sql`select 1; begin`;",
      "export const q = sql`select ${id}; Begin`;",
      "export const q = this.sql`START TRANSACTION`;",
      'export const q = sql.unsafe("Begin");',
      "export const q = sql.unsafe(`begin work`);",
    ];
    const file = (index) => `packages/trips/src/query-${index}.ts`;
    const result = run(
      Object.fromEntries(cases.map((source, index) => [file(index), `${source}\n`])),
    );
    assert.equal(result.status, 1);
    // The report points at the begin itself, so the commented case reports its third line.
    assert.deepEqual(
      problemLines(result).sort(),
      cases.map((_, index) => `${file(index)}:${index === 5 ? 3 : 1}`).sort(),
    );
  });

  it("passes begin as UI copy or as data inside SQL, and keeps the use-case prefix check", () => {
    const result = run({
      "apps/web/src/delivery/copy.ts": [
        'export const a = "Begin";',
        'export const b = "Begin your trip";',
        "export const c = `Begin ${name}`;",
        'export const d = "Begin to update your profile";',
        "export const e = html`Begin`;",
        "export const f = sql`select 'begin' as word from trip`;",
        "export const g = sql`select * from trip -- begin\n`;",
        "export const h = sql`select begin_at from trip`;",
      ].join("\n"),
      "apps/web/src/use-cases/start-trip.ts": 'export const label = "Begin work now";\n',
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["apps/web/src/use-cases/start-trip.ts:1"]);
  });

  it("fails, in a use-case, SQL text whose part starts with begin after an interpolation", () => {
    // Effect compiles `${sql.literal("")}begin` to exactly "begin". Main rejected both forms.
    const cases = [
      'export const q = sql`${sql.literal("")}begin`;',
      'export const q = sql`${sql.literal("/* unit */")}begin`;',
    ];
    const file = (index) => `apps/web/src/use-cases/open-${index}.ts`;
    const result = run(
      Object.fromEntries(cases.map((source, index) => [file(index), `${source}\n`])),
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      problemLines(result).sort(),
      cases.map((_, index) => `${file(index)}:1`),
    );
  });

  it("passes BEGIN inside a dollar-quoted body, and still fails a begin after one", () => {
    const result = run({
      "packages/trips/src/do-block.ts": [
        "export const a = sql`DO $$ DECLARE a int; BEGIN a := 1; END $$`;",
        "export const b = sql`DO $body$ BEGIN perform 1; END $body$ LANGUAGE plpgsql`;",
        "export const c = sql`DO $$ BEGIN perform 1; END $$; begin`;",
      ].join("\n"),
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["packages/trips/src/do-block.ts:3"]);
  });

  it("reads dollar bodies, comments, strings and quoted identifiers in one scan", () => {
    // Postgres runs DO, then BEGIN, for each but the $1 case: a "$$", '$$', $1 or comment opens
    // no dollar body, and a -- inside one hides no closing delimiter.
    const cases = [
      'export const q = sql`DO $$ BEGIN NULL; END $$; select 1 as "$$"; begin; select 2 as "$$"`;',
      "export const q = sql`DO $$ BEGIN NULL; END -- $$; begin\n`;",
      "export const q = sql`DO $$ BEGIN NULL; END $$ /* $$ */; begin`;",
      "export const q = sql`select '$$'; begin; select '$$'`;",
      "export const q = sql`select $1; begin; select $1`;",
      "export const q = sql`DO $a$ BEGIN PERFORM '$b$'; END $a$; begin; select $b$x$b$`;",
    ];
    const file = (index) => `packages/trips/src/scan-${index}.ts`;
    const result = run(
      Object.fromEntries(cases.map((source, index) => [file(index), `${source}\n`])),
    );
    assert.equal(result.status, 1);
    assert.deepEqual(
      problemLines(result).sort(),
      cases.map((_, index) => `${file(index)}:1`).sort(),
    );
  });

  it("counts nested block comments, so a dollar sign inside one opens no body", () => {
    // Postgres reads one comment from the outer /* to the last */, then runs BEGIN.
    const result = run({
      "apps/web/src/use-cases/nested.ts":
        "export const q = sql`DO $$ BEGIN NULL; END $$; /* outer /* inner */ $$ */; begin; select $$x$$`;\n",
      "packages/trips/src/nested.ts":
        "export const q = sql`select 1 /* outer /* inner */ ; begin; */ as one`;\n",
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["apps/web/src/use-cases/nested.ts:1"]);
  });

  it("passes a quoted identifier that holds a semicolon and begin", () => {
    // Postgres returns 1: the identifier is one name, not a statement.
    const result = run({
      "packages/trips/src/quoted.ts": 'export const q = sql`select 1 as "$$; begin; $$"`;\n',
      "apps/web/src/use-cases/quoted.ts": 'export const q = sql`select 1 as "x; begin"`;\n',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
