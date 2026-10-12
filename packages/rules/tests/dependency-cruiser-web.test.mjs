import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

// web-app: delivery pages that reach the server runtime and the database, and two declaration files
// that import framework build output, one at the app root and one under src/server/. Since 0.16.0 no
// option lets delivery reach the server: it imports src/composition/ instead.
const DEFAULT_VIOLATIONS = [
  "delivery-does-not-import-server: apps/web/src/delivery/pages/health-page.ts -> apps/web/src/server/database.ts",
  "delivery-does-not-import-server: apps/web/src/delivery/pages/item-page.ts -> apps/web/src/server/runtime/index.ts",
  "no-unresolved-imports: apps/web/framework-env.d.ts -> ./.framework/types/routes.d.ts",
  "no-unresolved-imports: apps/web/src/server/framework-env.d.ts -> ../../.framework/types/server.d.ts",
];

const ruleByName = (config, name) => config.forbidden.find((rule) => rule.name === name);

test("an empty generatedDeclarationFiles leaves the config as it was", () => {
  const plain = layout({ scope: "@acme/" });
  assert.deepEqual(layout({ scope: "@acme/", generatedDeclarationFiles: [] }), plain);
  assert.deepEqual(ruleByName(plain, "delivery-does-not-import-server").to, {
    path: "^apps/[^/]+/src/server(?:/|$)",
    reachable: true,
  });
  assert.deepEqual(ruleByName(plain, "no-unresolved-imports").from, {});
});

test("without the option, delivery may not import the server and declaration imports must resolve", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("web-app", layout({ scope: "@acme/" }))),
    DEFAULT_VIOLATIONS,
  );
});

// Removed in 0.16.0: delivery reaches use-cases through src/composition/ and the delivery adapters.
test("serverEntryFiles is gone, and the error says what replaces it", () => {
  for (const value of [[], ["runtime.ts"], "runtime.ts"]) {
    assert.throws(
      () => layout({ scope: "@acme/", serverEntryFiles: value }),
      (error) =>
        error instanceof TypeError &&
        error.message.startsWith("layout(): serverEntryFiles was removed in 0.16.0.") &&
        error.message.includes("src/composition/") &&
        error.message.includes("composition({ layer, caller, views })") &&
        error.message.includes("toFetchHandler, toMcpHandler or call") &&
        error.message.includes("Upgrading to 0.16.0"),
    );
  }
});

test("generatedDeclarationFiles exempts only the named files, relative to each app folder", async () => {
  const config = layout({ scope: "@acme/", generatedDeclarationFiles: ["framework-env.d.ts"] });
  assert.deepEqual(ruleByName(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:framework-env[.]d[.]ts)$",
  });
  assert.deepEqual(fromPaths(await violatedRules("web-app", config)), [
    ...DEFAULT_VIOLATIONS.slice(0, 2),
    DEFAULT_VIOLATIONS[3],
  ]);
});

test("generatedDeclarationFiles for both files leaves only the delivery violations", async () => {
  const config = layout({
    scope: "@acme/",
    generatedDeclarationFiles: ["framework-env.d.ts", "src/server/framework-env.d.ts"],
  });
  assert.deepEqual(
    fromPaths(await violatedRules("web-app", config)),
    DEFAULT_VIOLATIONS.slice(0, 2),
  );
});

test("generatedDeclarationFiles validates its paths", () => {
  for (const bad of [
    [""],
    ["/env.d.ts"],
    ["../env.d.ts"],
    [1],
    ["framework-env.ts"],
    ["src/app.tsx"],
    ["types.d.ts/"],
    "env.d.ts",
  ]) {
    assert.throws(
      () => layout({ scope: "@acme/", generatedDeclarationFiles: bad }),
      /generatedDeclarationFiles must be an array of relative paths .*ending in "\.d\.ts"/,
    );
  }
  assert.doesNotThrow(() =>
    layout({ scope: "@acme/", generatedDeclarationFiles: ["env.d.mts", ".gen/routes.d.cts"] }),
  );
});
