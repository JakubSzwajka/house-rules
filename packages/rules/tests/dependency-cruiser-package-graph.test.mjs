import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { findPackageCycles } from "../src/package-cycles.mjs";
import { findSubjectFolderCycles } from "../src/subject-folder-cycles.mjs";
import { cruiseFixture, violatedRules } from "./dependency-cruiser-helpers.mjs";

const base = {
  "apps/api/package.json": '{"name":"@acme/api"}',
  "apps/api/src/main.ts":
    "import { books } from '@acme/books'; import type { Book } from '@acme/books'; export const app = { books } as { books: Book[] };",
  "packages/books/package.json": '{"name":"@acme/books","exports":{".":"./src/index.ts"}}',
  "packages/books/src/index.ts":
    "import { store } from './adapters/memory/book.ts'; export { book } from './book/book.ts'; export type Book = string; export const books = store;",
  "packages/books/src/book/book.ts":
    "import { Schema } from 'effect'; export const book = { input: Schema };",
  "packages/books/src/adapters/memory/book.ts": "export const store = [];",
  "packages/books/src/adapters/postgres/book.ts":
    "import { SqlClient } from 'effect/unstable/sql'; export const rows = SqlClient;",
};
const config = layout({ scope: "@acme/" });
const cases = [
  [
    "package past door",
    "apps/api/src/deep.ts",
    "import {book} from '@acme/books/book/book.ts';",
    "no-unresolved-deep-package-imports",
  ],
  [
    "package to app",
    "packages/books/src/book/app.ts",
    "import {app} from '../../../../apps/api/src/main.ts';",
    "packages-do-not-import-apps",
  ],
  [
    "loose package root",
    "packages/books/src/loose.ts",
    "export const loose = 1;",
    "package-root-files",
  ],
  [
    "package mechanism",
    "packages/books/src/book/Errors.ts",
    "export const e = 1;",
    "no-ownerless-files",
  ],
  [
    "package SQL fence",
    "packages/books/src/book/sql.ts",
    "import {SqlClient} from 'effect/unstable/sql';",
    "adapter-imports-only-in-adapters",
  ],
  [
    "package adapter privacy",
    "packages/books/src/book/adapter.ts",
    "import {store} from '../adapters/memory/book.ts';",
    "domain-does-not-import-adapters",
  ],
  [
    "package test path",
    "packages/books/src/book/bad.test.ts",
    "export const test = 1;",
    "tests-live-in-tests-dir",
  ],
  [
    "subject barrel",
    "packages/books/src/book/root.ts",
    "import {books} from '../index.ts';",
    "subjects-do-not-import-package-root",
  ],
];
it("the base package graph passes the defaults", async () => {
  assert.deepEqual(await violatedRules(base, config), []);
});
for (const [name, file, source, rule] of cases)
  it(name, async () => {
    const violations = await violatedRules({ ...base, [file]: source }, config);
    assert.ok(
      violations.some((item) => item.rule === rule),
      JSON.stringify(violations),
    );
  });
it("package tests use adapter test support, never production adapters; domain uses neither", async () => {
  const support = "packages/books/src/adapters/tests/support.ts";
  const at = "packages/books/src/tests/store.test.ts";
  const tree = {
    ...base,
    [support]: 'export { store } from "../memory/book.ts";',
    [at]: 'import { store } from "../adapters/tests/support.ts";',
  };
  assert.deepEqual(await violatedRules(tree, config), []);
  const badTest = await violatedRules(
    { ...tree, [at]: 'import { store } from "../adapters/memory/book.ts";' },
    config,
  );
  assert.ok(
    badTest.some(({ rule, from }) => rule === "domain-does-not-import-adapters" && from === at),
  );
  const badDomain = await violatedRules(
    {
      ...tree,
      ["packages/books/src/book/support.ts"]:
        'import { store } from "../adapters/tests/support.ts";',
    },
    config,
  );
  assert.ok(badDomain.some(({ rule }) => rule === "domain-does-not-import-adapters"));
  assert.ok(badDomain.some(({ rule }) => rule === "production-does-not-import-tests"));
});
it("package cycles fail even when files are individually acyclic", async () => {
  const tree = {
    ...base,
    "packages/one/package.json": '{"name":"@acme/one","exports":{".":"./src/index.ts"}}',
    "packages/two/package.json": '{"name":"@acme/two","exports":{".":"./src/index.ts"}}',
    ["packages/one/src/index.ts"]: "export {one} from './one/one.ts';",
    ["packages/one/src/one/one.ts"]: "import {two} from '@acme/two'; export const one = two;",
    ["packages/one/src/other/other.ts"]: "export const other = {};",
    ["packages/two/src/index.ts"]: "export {two} from './two/two.ts';",
    ["packages/two/src/two/two.ts"]: "export const two = {};",
    ["packages/two/src/other/other.ts"]:
      "import {other} from '@acme/one'; export const otherTwo = other;",
  };
  await cruiseFixture(tree, config, async ({ modules, workspace }) => {
    assert.equal((await findPackageCycles(modules, config, { baseDir: workspace })).length, 1);
    writeFileSync(
      path.join(workspace, ".dependency-cruiser.cjs"),
      `module.exports=${JSON.stringify(config)}`,
    );
    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, "../bin/layout.mjs"), "--cwd", workspace],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no-package-cycles/);
  });
});
it("subject cycles inside packages retain adapter/test exclusions", async () => {
  const tree = {
    ...base,
    ["packages/books/src/book/book.ts"]:
      "import {price} from '../price/price.ts'; export const book = price;",
    ["packages/books/src/book/other.ts"]: "export const other = {};",
    ["packages/books/src/price/price.ts"]: "export const price = {};",
    ["packages/books/src/price/other.ts"]:
      "import {other} from '../book/other.ts'; export const next = other;",
  };
  await cruiseFixture(tree, config, ({ modules, workspace }) =>
    assert.equal(findSubjectFolderCycles(modules, config, workspace).length, 1),
  );
});
