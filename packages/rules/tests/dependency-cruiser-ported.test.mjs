import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { findAppFolderCycles } from "../src/app-folder-cycles.mjs";
import {
  FIXTURES,
  cruiseFixture,
  fromPaths,
  ruleNames,
  violatedRules,
} from "./dependency-cruiser-helpers.mjs";

const config = layout({ scope: "@acme/" });
const root = "apps/web/src/";
const treeFor = async (name) => {
  const directory = path.join(FIXTURES, name);
  const files = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      files
        .filter((file) => file.isFile())
        .map(async (file) => {
          const full = path.join(file.parentPath, file.name);
          return [path.relative(directory, full), await readFile(full, "utf8")];
        }),
    ),
  );
};

test("ported clean and Node trees pass defaults and reject a new outer-folder edge", async () => {
  for (const name of ["clean", "node-app"]) {
    const tree = await treeFor(name);
    assert.deepEqual(await violatedRules(tree, config), []);
    const handler = "apps/api/src/features/show-booking/handler.ts";
    const bad = { ...tree, [handler]: 'export { app } from "../../composition/index.ts";' };
    if (name === "clean") bad["apps/api/src/composition/index.ts"] = "export const app = {};";
    assert.deepEqual(
      fromPaths(await violatedRules(bad, config)),
      (name === "clean" ? ["index.ts"] : ["app-layer.ts", "index.ts", "views.ts"]).map(
        (file) =>
          `features-do-not-import-outer-folders: ${handler} -> apps/api/src/composition/${file}`,
      ),
    );
  }
});

const directions = [
  [
    "server-does-not-import-delivery",
    "packages/web-runtime/src/index.ts",
    "export const route = 1;",
    "packages-do-not-import-apps",
  ],
  [
    "use-cases-do-not-import-outer-layers",
    "features/show/handler.ts",
    "export const route = 1;",
    "features-do-not-import-outer-folders",
  ],
  [
    "use-cases-do-not-import-composition",
    "features/show/handler.ts",
    "export const app = {};",
    "features-do-not-import-outer-folders",
  ],
  [
    "composition-imports-packages-only",
    "composition/index.ts",
    'export { loop } from "./loop"; export { show } from "../features/show/handler";',
    "composition-does-not-import-ways-in",
  ],
];
for (const [name, file, repaired, rule] of directions) {
  test(`ported ${name} fails its new rule and passes after repairing that edge`, async () => {
    const tree = await treeFor(`violations/${name}`);
    assert.deepEqual(ruleNames(await violatedRules(tree, config)), [rule]);
    assert.deepEqual(
      await violatedRules(
        { ...tree, [file.startsWith("packages/") ? file : root + file]: repaired },
        config,
      ),
      [],
    );
  });
}

test("composition test files cannot import ways either", async () => {
  const tree = await treeFor("violations/composition-imports-packages-only");
  tree[root + "composition/index.ts"] = 'export { show } from "../features/show/handler";';
  const file = root + "composition/tests/app.test.ts";
  assert.deepEqual(await violatedRules(tree, config), []);
  tree[file] = 'import { route } from "../../ways-in/route"; export const checked = route;';
  assert.deepEqual(fromPaths(await violatedRules(tree, config)), [
    `composition-does-not-import-ways-in: ${file} -> ${root}ways-in/route.ts`,
  ]);
});

test("bridges cannot hide way/module or node/outer-folder edges, including outside src", async () => {
  const tree = await treeFor("bridges");
  assert.deepEqual(fromPaths(await violatedRules(tree, config)), [
    "features-do-not-import-outer-folders: apps/use-case-to-composition/src/features/show/handler.ts -> apps/use-case-to-composition/src/composition/index.ts",
    "features-do-not-import-outer-folders: apps/use-case-to-outer/src/features/book/handler.ts -> apps/use-case-to-outer/src/ways-in/route.ts",
    "packages-do-not-import-apps: packages/server-to-delivery-runtime/src/task/loop.ts -> apps/server-to-delivery/src/main.ts",
    "ways-in-import-app-folders-only: apps/delivery-to-server/src/ways-in/route.ts -> apps/delivery-to-server/src/index.ts",
    "ways-in-import-app-folders-only: apps/outside-src/src/ways-in/route.ts -> apps/outside-src/bridge.ts",
    "ways-in-import-contracts-only: apps/delivery-to-server/src/ways-in/route.ts -> apps/delivery-to-server/src/index.ts",
    "ways-in-import-contracts-only: apps/outside-src/src/ways-in/route.ts -> apps/outside-src/bridge.ts",
  ]);
  assert.deepEqual(
    await violatedRules(
      {
        ...tree,
        "packages/server-to-delivery-runtime/src/task/loop.ts": "export const loop = () => 200;",
        "apps/use-case-to-composition/src/features/show/handler.ts":
          "export const show = () => true;",
        "apps/use-case-to-outer/src/features/book/handler.ts":
          'import { cancel } from "../cancel/handler"; export const book = () => cancel();',
        "apps/delivery-to-server/src/ways-in/route.ts": "export const route = () => 200;",
        "apps/outside-src/src/ways-in/route.ts": "export const route = () => 200;",
      },
      config,
    ),
    [],
  );
});

test("retired cross-use-case ban becomes allowed node calls, with a node-folder cycle failure", async () => {
  const tree = await treeFor("violations/use-cases-do-not-import-use-cases");
  assert.deepEqual(await violatedRules(tree, config), []);
  await cruiseFixture(tree, config, ({ modules, workspace }) =>
    assert.deepEqual(findAppFolderCycles(modules, config, workspace), []),
  );
  tree[root + "features/cancel/policy.ts"] =
    'import { refund } from "../refund/handler"; export const allowed = refund;';
  await cruiseFixture(tree, config, ({ modules, workspace }) => {
    assert.deepEqual(findAppFolderCycles(modules, config, workspace), [
      {
        rule: "no-app-feature-cycles",
        cycle: [`${root}features/cancel`, `${root}features/refund`, `${root}features/cancel`],
      },
    ]);
  });
});

test("ported Next bridge fails while direct node use passes", async () => {
  const tree = await treeFor("next-bridge");
  const next = layout({ scope: "@acme/", host: "next" });
  assert.deepEqual(ruleNames(await violatedRules(tree, next)), [
    "ways-in-import-app-folders-only",
    "ways-in-import-contracts-only",
  ]);
  tree[root + "app/page.tsx"] = "export const page = () => null;";
  assert.deepEqual(await violatedRules(tree, next), []);
});

test("renamed node area keeps both verdicts with a named handler folder", async () => {
  const tree = await treeFor("renamed-layers");
  const renamed = layout({ scope: "@acme/", layers: { features: "application" } });
  assert.deepEqual(ruleNames(await violatedRules(tree, renamed)), [
    "features-do-not-import-outer-folders",
  ]);
  tree[root + "application/show/handler.ts"] = "export const route = 1;";
  assert.deepEqual(await violatedRules(tree, renamed), []);
});

test("ported web fixture retains module-value, private-door, module-direction and declaration failures", async () => {
  const tree = await treeFor("web-app");
  assert.deepEqual(ruleNames(await violatedRules(tree, config)), [
    "no-unresolved-deep-package-imports",
    "no-unresolved-imports",
    "package-root-files",
    "packages-do-not-import-apps",
    "ways-in-import-contracts-only",
  ]);
  const repaired = {
    ...tree,
    ["packages/web-runtime/src/runtime/index.ts"]:
      "export const runtime = { run: (id: string) => ({ id }) };",
    ["packages/web-runtime/src/index.ts"]:
      'export { runtime } from "./runtime/index"; export const connection = "pool";',
    [root + "composition/start.ts"]:
      'import { runtime } from "@acme/web-runtime"; export const start = () => runtime.run("b1");',
    [root + "ways-in/pages/health-page.ts"]:
      'import type { connection } from "@acme/web-runtime"; export type Connection = typeof connection;',
    [root + "ways-in/pages/item-page.ts"]:
      'import { showItem } from "../../features/show-item/handler"; export const page = showItem;',
    "apps/web/.framework/types/routes.d.ts": "export {};",
    "apps/web/.framework/types/server.d.ts": "export {};",
  };
  // The on-disk loose module declaration is deliberately bad. The positive tree puts it in composition.
  const { ["packages/web-runtime/src/framework-env.d.ts"]: declaration, ...good } = repaired;
  good[root + "composition/framework-env.d.ts"] = 'import "../../.framework/types/server.d.ts";';
  assert.deepEqual(await violatedRules(good, config), []);
});

test("ways cannot import package main values after folder-module removal", async () => {
  assert.deepEqual(
    await violatedRules(await treeFor("violations/delivery-does-not-import-server"), config),
    [
      {
        rule: "ways-in-import-contracts-only",
        from: "apps/web/src/ways-in/route.ts",
        to: "packages/web-runtime/src/index.ts",
      },
    ],
  );
});
