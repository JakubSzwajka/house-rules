import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const tree = {
  "apps/web/package.json": "{}",
  "apps/web/framework-env.d.ts": 'import "./.framework/types/routes.d.ts";',
  "apps/web/src/composition/framework-env.d.ts": 'import "../../.framework/types/server.d.ts";',
  "apps/web/src/ways-in/web/page.ts": 'import {db} from "../../read-models/db/index.ts";',
  "apps/web/src/read-models/db/index.ts": "export const db = {};",
};
const valueViolations = [
  "ways-in-do-not-import-read-model-values: apps/web/src/ways-in/web/page.ts -> apps/web/src/read-models/db/index.ts",
  "ways-in-import-contracts-only: apps/web/src/ways-in/web/page.ts -> apps/web/src/read-models/db/index.ts",
];
const unresolved = [
  "no-unresolved-imports: apps/web/framework-env.d.ts -> ./.framework/types/routes.d.ts",
  "no-unresolved-imports: apps/web/src/composition/framework-env.d.ts -> ../../.framework/types/server.d.ts",
];
const rule = (config, name) => config.forbidden.find((item) => item.name === name);
test("empty generated declarations preserve the whole config", () => {
  const plain = layout({ scope: "@acme/" });
  assert.deepEqual(layout({ scope: "@acme/", generatedDeclarationFiles: [] }), plain);
  assert.deepEqual(rule(plain, "no-unresolved-imports").from, {});
  assert.deepEqual(rule(plain, "ways-in-do-not-import-read-model-values").to, {
    path: "^apps/[^/]+/src/read-models(?:/|$)",
    dependencyTypesNot: ["type-only"],
  });
  assert.ok(plain.forbidden.every(({ severity }) => severity === "error"));
});
test("web values are fenced and unconfigured declarations must resolve", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules(tree, layout({ scope: "@acme/" }))),
    [...unresolved, ...valueViolations].sort(),
  );
});
test("removed server-entry option fails with current root/router guidance", () => {
  for (const value of [[], ["runtime.ts"], "runtime.ts"])
    assert.throws(() => layout({ scope: "@acme/", serverEntryFiles: value }), {
      name: "TypeError",
      message:
        "layout(): serverEntryFiles was removed in 0.16.0. Put root wiring in src/composition/ as composition({ modules, features, ways, may, system, gatePolicy? }); ways may import the root, and main.ts passes way values into it. Use toFetchHandler for the router. Remove the option. See @house-rules/rules docs/dependency-cruiser.md.",
    });
});
test("generated declarations exempt only the named app-relative files", async () => {
  const config = layout({ scope: "@acme/", generatedDeclarationFiles: ["framework-env.d.ts"] });
  assert.deepEqual(rule(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:framework-env[.]d[.]ts)$",
  });
  assert.deepEqual(
    fromPaths(await violatedRules(tree, config)),
    [unresolved[1], ...valueViolations].sort(),
  );
});
test("naming both declarations keeps module-value fences enabled", async () => {
  const config = layout({
    scope: "@acme/",
    generatedDeclarationFiles: ["framework-env.d.ts", "src/composition/framework-env.d.ts"],
  });
  assert.deepEqual(fromPaths(await violatedRules(tree, config)), valueViolations);
});
test("generated declaration path validation stays strict", () => {
  for (const bad of [
    [""],
    ["/env.d.ts"],
    ["../env.d.ts"],
    [1],
    ["framework-env.ts"],
    ["src/app.tsx"],
    ["types.d.ts/"],
    "env.d.ts",
  ])
    assert.throws(
      () => layout({ scope: "@acme/", generatedDeclarationFiles: bad }),
      /generatedDeclarationFiles must be an array of relative paths .*ending in "\.d\.ts"/,
    );
  assert.doesNotThrow(() =>
    layout({ scope: "@acme/", generatedDeclarationFiles: ["env.d.mts", ".gen/routes.d.cts"] }),
  );
});
