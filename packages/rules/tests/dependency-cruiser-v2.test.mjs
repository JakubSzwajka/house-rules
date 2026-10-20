import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { findAppFolderCycles } from "../src/app-folder-cycles.mjs";
import { findPackageCycles } from "../src/package-cycles.mjs";
import { findSubjectFolderCycles } from "../src/subject-folder-cycles.mjs";
import { cruiseFixture, violatedRules } from "./dependency-cruiser-helpers.mjs";

const base = JSON.parse(
  readFileSync(new URL("./fixtures/dependency-cruiser/v2-app/tree.json", import.meta.url), "utf8"),
);
const config = layout({ scope: "@acme/" });
const root = "apps/api/src/";
const cases = [
  [
    "node handler cannot import composition",
    "features/show/handler.ts",
    "import { root } from '../../composition/index.ts';",
    "features-do-not-import-outer-folders",
  ],
  [
    "descriptor cannot import handler",
    "features/show/node.ts",
    "import {handler} from './handler.ts'; export const show = handler;",
    "contract-entry-is-browser-safe",
  ],
  [
    "package past door",
    "composition/index.ts",
    "import {book} from '@acme/books/book/book.ts';",
    "no-unresolved-deep-package-imports",
  ],
  [
    "read model past door",
    "composition/index.ts",
    "import {report} from '../read-models/report/report/report.ts';",
    "read-models-public-entry-only",
  ],
  [
    "way read-model value",
    "ways-in/web/way.ts",
    "import {books} from '../../read-models/report/index.ts';",
    "ways-in-do-not-import-read-model-values",
  ],
  [
    "package to node",
    "packages/books/src/facade.ts",
    "import {show} from '../../../apps/api/src/features/show/node.ts';",
    "packages-do-not-import-apps",
  ],
  [
    "read model to feature",
    "read-models/report/report/report.ts",
    "import {books} from '../../../features/show/node.ts';",
    "read-models-import-packages-only",
  ],
  [
    "composition to way",
    "composition/index.ts",
    "import {way} from '../ways-in/web/way.ts';",
    "composition-does-not-import-ways-in",
  ],
  [
    "way to another way",
    "ways-in/partner/way.ts",
    "import {way} from '../web/way.ts';",
    "ways-in-do-not-import-other-ways",
  ],
  [
    "loose folder root",
    "packages/books/src/loose.ts",
    "export const loose = 1;",
    "package-root-files",
  ],
  [
    "folder mechanism",
    "packages/books/src/book/Errors.ts",
    "export const e = 1;",
    "no-ownerless-files",
  ],
  [
    "folder SQL fence",
    "packages/books/src/book/sql.ts",
    "import {SqlClient} from 'effect/unstable/sql';",
    "adapter-imports-only-in-adapters",
  ],
  [
    "folder adapter privacy",
    "packages/books/src/book/adapter.ts",
    "import {store} from '../adapters/memory/book.ts';",
    "domain-does-not-import-adapters",
  ],
  [
    "folder test path",
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
it("rejects removed area keys and literal app areas without aliases", async () => {
  for (const area of ["nodes", "modules"]) {
    assert.throws(() => layout({ scope: "@acme/", layers: { [area]: area } }), /unknown layer/);
    const from = `${root}${area}/old/node.ts`;
    assert.deepEqual(await violatedRules({ [from]: "export const old = {};" }, config), [
      { rule: "app-folders", from, to: from },
    ]);
  }
});
it("default v2 roots permit schema/contract/read-model edges and type-only way imports", async () => {
  assert.deepEqual(await violatedRules(base, config), []);
});
it("per-node entries are shared browser roots, including unexposed and custom roots", async () => {
  const tree = {
    ...base,
    [root + "features/show/entry.ts"]: "import {show} from './node.ts'; export const entry = show;",
    [root + "features/unexposed/entry.ts"]: "export const entry = {};",
    [root + "ways-in/web/endpoints.ts"]:
      "import {entry} from '../../features/show/entry.ts'; export const endpoints = [entry];",
    [root + "ways-in/web/way.ts"]:
      "import {entry} from '../../features/show/entry.ts'; export const way = entry;",
    [root + "composition/index.ts"]:
      "import {entry} from '../features/show/entry.ts'; export const root = entry;",
  };
  assert.deepEqual(await violatedRules(tree, config), []);
  const custom = Object.fromEntries(
    Object.entries(tree).map(([file, code]) => [
      file.replace(/^apps\//u, "examples/booking/apps/"),
      code,
    ]),
  );
  assert.deepEqual(
    await violatedRules(custom, layout({ scope: "@acme/", appsDir: ["examples/booking/apps"] })),
    [],
  );
  for (const [file, code] of [
    ["features/show/entry.ts", "import {handler} from './handler.ts';"],
    ["features/show/entry.ts", "import {root} from '../../composition/index.ts';"],
    ["features/show/entry.ts", "import {store} from '@acme/books/adapters/memory/book.ts';"],
    [
      "features/show/entry.ts",
      "import type {store} from '@acme/books/adapters/memory/book.ts'; export type X = typeof store;",
    ],
    ["features/unexposed/entry.ts", "import {handler} from '../show/handler.ts';"],
    [
      "features/unexposed/entry.ts",
      "import type {handler} from '../show/handler.ts'; export type X = typeof handler;",
    ],
    ["features/show/node.ts", "import {handler} from './handler.ts'; export const show = handler;"],
    ["ways-in/web/endpoints.ts", "import {root} from '../../composition/index.ts';"],
    ["ways-in/web/endpoints.ts", "import {entry} from '../../features/entries.ts';"],
  ]) {
    const violations = await violatedRules(
      { ...tree, [root + "features/entries.ts"]: "export const entry = {};", [root + file]: code },
      config,
    );
    assert.ok(
      violations.some(({ rule }) => rule === "contract-entry-is-browser-safe"),
      `${file}: ${JSON.stringify(violations)}`,
    );
  }
  const mainDoor = {
    ...tree,
    [root + "features/unexposed/entry.ts"]:
      "import * as server from '@house-rules/application'; export const entry = server;",
  };
  assert.ok(
    (await violatedRules(mainDoor, config)).some(
      ({ rule }) => rule === "contract-entry-is-browser-safe",
    ),
  );
});
for (const [name, file, source, rule] of cases)
  it(name, async () => {
    const violations = await violatedRules(
      { ...base, [file.startsWith("packages/") ? file : root + file]: source },
      config,
    );
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
it("domain cannot import application, even type-only contract imports", async () => {
  for (const source of [
    "import {Entry} from '@house-rules/application/contract';",
    "import type {Entry} from '@house-rules/application/contract';",
  ]) {
    const violations = await violatedRules(
      {
        "packages/domain/package.json": '{"name":"@house-rules/domain","exports":"./src/index.ts"}',
        "packages/domain/src/index.ts": source,
      },
      config,
    );
    assert.ok(violations.some(({ rule }) => rule === "domain-imports-no-house-rules"));
  }
});
it("feature and package cycles fail even when files are individually acyclic", async () => {
  const tree = {
    ...base,
    "packages/one/package.json": '{"name":"@acme/one","exports":{".":"./src/index.ts"}}',
    "packages/two/package.json": '{"name":"@acme/two","exports":{".":"./src/index.ts"}}',
    [root + "features/a/node.ts"]: "import {b} from '../b/node.ts'; export const a = b;",
    [root + "features/a/handler.ts"]: "export const aHandler = {};",
    [root + "features/b/node.ts"]: "export const b = {};",
    [root + "features/b/handler.ts"]:
      "import {aHandler} from '../a/handler.ts'; export const bHandler = aHandler;",
    ["packages/one/src/index.ts"]: "export {one} from './one/one.ts';",
    ["packages/one/src/one/one.ts"]: "import {two} from '@acme/two'; export const one = two;",
    ["packages/one/src/other/other.ts"]: "export const other = {};",
    ["packages/two/src/index.ts"]: "export {two} from './two/two.ts';",
    ["packages/two/src/two/two.ts"]: "export const two = {};",
    ["packages/two/src/other/other.ts"]:
      "import {other} from '@acme/one'; export const otherTwo = other;",
  };
  await cruiseFixture(tree, config, async ({ modules, workspace }) => {
    const cycles = findAppFolderCycles(modules, config, workspace);
    assert.ok(
      cycles.some(({ rule }) => rule === "no-app-feature-cycles"),
      JSON.stringify(cycles),
    );
    assert.ok(
      (await findPackageCycles(modules, config, { baseDir: workspace })).length === 1,
      JSON.stringify(cycles),
    );
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
    assert.match(result.stderr, /no-app-feature-cycles/);
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
