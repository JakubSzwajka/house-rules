import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { findAppFolderCycles } from "../src/app-folder-cycles.mjs";
import { cruiseFixture, violatedRules } from "./dependency-cruiser-helpers.mjs";

const base = JSON.parse(
  readFileSync(new URL("./fixtures/dependency-cruiser/v2-app/tree.json", import.meta.url), "utf8"),
);
const config = layout({ scope: "@acme/" });
const root = "apps/api/src/";
for (const file of ["report/bridge.ts", "adapters/postgres/bridge.ts"])
  it(`read-model whole-app boundary rejects ${file}`, async () => {
    const from = `${root}read-models/report/${file}`;
    const back = file.startsWith("adapters") ? "../../../../../" : "../../../../";
    assert.deepEqual(
      await violatedRules(
        {
          ...base,
          "apps/api/bridge.ts": "export {books} from '@acme/books';",
          [from]: `import {books} from '${back}bridge.ts'; export const bridge = books;`,
        },
        config,
      ),
      [{ rule: "read-models-import-packages-only", from, to: "apps/api/bridge.ts" }],
    );
  });
it("module index-only boundary rejects an outside-src foreign-contract bridge", async () => {
  const from = "packages/books/src/book/bridge.ts";
  assert.deepEqual(
    await violatedRules(
      {
        ...base,
        "apps/api/bridge.ts": "export {book} from '@acme/books/contract';",
        [from]: "import {book} from '../../../../apps/api/bridge.ts'; export const orders = book;",
      },
      config,
    ),
    [{ rule: "packages-do-not-import-apps", from, to: "apps/api/bridge.ts" }],
  );
  assert.deepEqual(
    await violatedRules(
      { ...base, [from]: "import {books} from './book.ts'; export const orders = books;" },
      config,
    ),
    [],
  );
});
const barrelTree = {
  ...base,
  [`${root}features/index.ts`]:
    "export {p as pa} from './a/policy.ts'; export {p as pb} from './b/policy.ts';",
  [`${root}features/a/policy.ts`]: "export const p = 1;",
  [`${root}features/b/policy.ts`]: "export const p = 2;",
  [`${root}features/a/handler.ts`]: "import {pb} from '../index.ts'; export const h = pb;",
  [`${root}features/b/handler.ts`]: "import {pa} from '../index.ts'; export const h = pa;",
};
it("detects the exact node-folder cycle through features/index without a file cycle", async () => {
  assert.deepEqual(await violatedRules(barrelTree, config), []);
  await cruiseFixture(barrelTree, config, ({ modules, workspace }) => {
    assert.deepEqual(findAppFolderCycles(modules, config, workspace), [
      {
        rule: "no-app-feature-cycles",
        cycle: [`${root}features/a`, `${root}features/b`, `${root}features/a`],
      },
    ]);
  });
});
it("keeps one-way node calls through a barrel valid", async () => {
  const tree = { ...barrelTree, [`${root}features/b/handler.ts`]: "export const h = 2;" };
  assert.deepEqual(await violatedRules(tree, config), []);
  await cruiseFixture(tree, config, ({ modules, workspace }) =>
    assert.deepEqual(findAppFolderCycles(modules, config, workspace), []),
  );
});
