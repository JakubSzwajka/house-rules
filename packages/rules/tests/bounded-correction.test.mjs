import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin, { nodesConfig } from "../src/index.mjs";
import { readModelSqlProblems } from "../src/read-model-sql.mjs";
import { run } from "./migrations-helpers.mjs";

const repo = path.resolve(import.meta.dirname, "../../..");
const full = [...plugin.configs.recommended, ...nodesConfig()];
const lint = (cwd, code, file) =>
  new Linter({ cwd })
    .verify(code, full, { filename: path.join(cwd, file) })
    .filter(
      (m) =>
        m.ruleId === "house-rules/entry-from-app-node" ||
        m.ruleId === "house-rules/esm-only-effect" ||
        m.fatal,
    );
for (const name of ["comments", "party", "identity"]) {
  it(`allows the real finished ${name} descriptor and binder door`, () => {
    const file = `packages/${name}/src/index.ts`;
    assert.deepEqual(lint(repo, readFileSync(path.join(repo, file), "utf8"), file), []);
  });
}
for (const [name, binder] of [
  ["comments", "bindComments"],
  ["party", "bindParty"],
  ["identity", "bindIdentity"],
])
  it(`allows documented app mount ${binder}`, () =>
    assert.deepEqual(
      lint(
        repo,
        `import { ${binder} } from "@house-rules/${name}"; export const bindings = ${binder}(service);`,
        "apps/demo/src/composition/mount.ts",
      ),
      [],
    ));

for (const [file, code] of [
  ["apps/demo/src/composition/star.ts", 'export * from "@house-rules/comments";'],
  ["apps/demo/src/composition/star.ts", 'export * from "@house-rules/comments/contract";'],
  ["apps/demo/src/composition/star.ts", 'export * from "@house-rules/party/contract";'],
  ["packages/comments/src/star.ts", 'export * from "./contract.js";'],
])
  it(`allows finished-value star: ${code}`, () => assert.deepEqual(lint(repo, code, file), []));

for (const area of ["packages/comments/src", "apps/demo/src/composition"])
  for (const source of ["@house-rules/domain", "@house-rules/application"])
    for (const star of ["*", "* as Kit"])
      it(`rejects ${area} export ${star} from ${source}`, () =>
        assert.ok(
          lint(repo, `export ${star} from "${source}";`, `${area}/star.ts`).some(
            (m) => m.messageId === "named",
          ),
        ));

for (const name of ["defineEntry", "defineWay", "endpoint"])
  for (const usage of [`export type T = typeof ${name};`, `${name}(x);`])
    it(`reports forbidden runtime package import ${name}: ${usage}`, () => {
      const messages = lint(
        repo,
        `import { ${name} } from "@house-rules/application"; ${usage}`,
        "packages/comments/src/runtime.ts",
      );
      assert.ok(messages.some((m) => m.messageId === "named"));
      assert.ok(messages.every((m) => m.messageId !== "origin"));
    });
for (const modifier of ["type ", "inline"])
  it(`allows genuine ${modifier} builder imports`, () => {
    const code =
      modifier === "inline"
        ? 'import { type defineEntry, type defineWay, type endpoint } from "@house-rules/application";'
        : 'import type { defineEntry, defineWay, endpoint } from "@house-rules/application";';
    assert.deepEqual(
      lint(
        repo,
        `${code} export type T = [typeof defineEntry, typeof defineWay, typeof endpoint];`,
        "packages/comments/src/types.ts",
      ),
      [],
    );
  });

for (const sql of [
  "do $$ begin insert into orders values ('x'); end $$;",
  "create function f() returns void language sql as $$ insert into orders values ('x'); $$;",
  "create function f() returns trigger language plpgsql as $f$ begin delete from orders; return new; end $f$;",
  "do $$ begin perform 'unclosed; insert into orders values (1); end $$;",
])
  it(`restores best-effort dollar-body ownership: ${sql}`, () => {
    const result = run({
      "packages/auth/migrations/0001_orders.sql": "create table orders(id text);",
      "packages/trips/migrations/0001_bill.sql": `create table bill(id text); ${sql}`,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /touches "orders"/u);
  });
it("allows own-module DO writes", () => {
  const result = run({
    "packages/trips/migrations/0001_bill.sql":
      "create table bill(id text); do $$ begin insert into bill values ('x'); end $$;",
  });
  assert.equal(result.status, 0, result.stderr);
});

const root = mkdtempSync(path.join(tmpdir(), "bounded-correction-"));
for (const [file, content] of Object.entries({
  "apps/api/package.json": "{}",
  "packages/peer/package.json": '{"peerDependencies":{"effect":"4.0.3"}}',
  "packages/preset/package.json": "{}",
  "packages/preset/tsconfig.json": '{"extends":"@house-rules/rules/tsconfig/effect.json"}',
  "packages/fake/package.json": '{"name":"@house-rules/rules","dependencies":{"effect":"4.0.3"}}',
  "packages/plain/package.json": '{"name":"@acme/plain","exports":{".":"./src/index.ts"}}',
  "packages/plain/src/index.ts": 'export { createRequire as loader } from "node:module";',
  "scripts/loader.mjs": 'export { createRequire as loader } from "node:module";',
  "scripts/star.mjs": 'export * from "@house-rules/application";',
  "apps/api/src/features/book/node.ts":
    'import { defineNode } from "@house-rules/domain/contract"; export const book = defineNode("book", {});',
  "packages/plain/src/subject/finished.ts":
    'import { defineNode } from "@house-rules/domain/contract"; import { bindNode } from "@house-rules/application"; const privateBuilder = (n: string) => defineNode(n, {}); export const book = defineNode("book", {}); export const bindBook = (service: unknown) => bindNode(book, service);',
  "packages/plain/src/subject/builders.ts":
    'export { defineNode } from "@house-rules/domain/contract"; export const finished = 1;',
  "packages/plain/src/subject/selected.ts": 'export { finished } from "./builders.ts";',
})) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}
for (const [file, code] of [
  ["apps/api/src/features/index.ts", 'export * from "./book/node.ts";'],
  ["packages/plain/src/index.ts", 'export * from "./subject/finished.ts";'],
  ["packages/plain/src/index.ts", 'export * from "./subject/selected.ts";'],
])
  it(`follows only actual exported values: ${code}`, () =>
    assert.deepEqual(lint(root, code, file), []));
for (const code of [
  'const { createRequire } = await import("node:module"); createRequire(import.meta.url)',
  '(await import("node:module")).createRequire(import.meta.url)',
  'const { require: load } = module; load("x")',
  'const m = module; m.require("x")',
  'globalThis["require"]("x")',
  'export { createRequire } from "node:module"',
  'export * from "module"',
  'import { loader } from "@acme/plain"; loader(import.meta.url)("x")',
  'import { loader } from "../../../../scripts/loader.mjs"; loader(import.meta.url)("x")',
])
  it(`rejects listed loader gap: ${code}`, () =>
    assert.ok(
      lint(root, code, "apps/api/src/composition/main.ts").some((m) => m.messageId === "esm"),
    ));
for (const name of ["peer", "preset", "fake"])
  it(`classifies ${name} Effect package without a name-only exemption`, () =>
    assert.ok(
      lint(root, 'require("x")', `packages/${name}/src/main.ts`).some((m) => m.messageId === "esm"),
    ));
for (const code of [
  'export * from "../../../../scripts/star.mjs";',
  'export { bindNode as bind } from "@house-rules/application";',
  'import { defineEntry } from "@house-rules/application";',
  'import { defineWay as way } from "@house-rules/application";',
  'import { endpoint } from "@house-rules/application/contract";',
])
  it(`rejects direct import/reexport boundary: ${code}`, () =>
    assert.ok(
      lint(root, code, "packages/peer/src/subject/main.ts").some((m) => m.messageId === "named"),
    ));
it("allows type-only star kit exports", () =>
  assert.deepEqual(
    lint(root, 'export type * from "@house-rules/application";', "packages/peer/src/main.ts"),
    [],
  ));

for (const word of ["standard_conforming_strings", "BACKSLASH_QUOTE", "set_config", "Pg_Settings"])
  for (const sql of [
    `select '${word}'`,
    `-- ${word}\nselect 1`,
    `do $q$ begin raise notice '${word}'; end $q$`,
  ])
    it(`reserves raw SQL words even inside literals/comments/bodies: ${sql}`, () => {
      const result = run({
        "packages/trips/migrations/0001_bill.sql": `create table bill(id text); ${sql};`,
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /SQL reserves/u);
      assert.ok(
        readModelSqlProblems(
          `import {SqlClient as C} from "effect/sql"; const q = Effect.gen(function*(){ const db = yield* C.SqlClient; return db\`${sql}\`; });`,
          new Set(),
        ).some((p) => p.includes("SQL reserves")),
      );
    });
it("does not ban reserved names in unrelated JS prose", () =>
  assert.deepEqual(
    readModelSqlProblems(
      'const explanation = "standard_conforming_strings pg_settings set_config backslash_quote";',
      new Set(),
    ),
    [],
  ));
for (const sql of [
  "with x as (select $q$'$q$ as v) insert into orders(id) select $q$'$q$ from x;",
  "select $q$'$q$;\n--> statement-breakpoint\ninsert into orders(id) select $q$'$q$;",
])
  it(`uses the PG lexer for dollar-apostrophe legacy ownership: ${sql}`, () => {
    const result = run({
      "packages/auth/migrations/0001_orders.sql": "create table orders(id text);",
      "packages/trips/migrations/0001_bill.sql": `create table bill(id text); ${sql}`,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /touches "orders"/u);
  });
