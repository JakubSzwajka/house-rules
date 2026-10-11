import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

// web-app: delivery pages that reach the server runtime and the database, and two declaration files
// that import framework build output, one at the app root and one under src/server/.
const DEFAULT_VIOLATIONS = [
  "delivery-does-not-import-server: apps/web/src/delivery/pages/health-page.ts -> apps/web/src/server/database.ts",
  "delivery-does-not-import-server: apps/web/src/delivery/pages/item-page.ts -> apps/web/src/server/runtime/index.ts",
  "no-unresolved-imports: apps/web/framework-env.d.ts -> ./.framework/types/routes.d.ts",
  "no-unresolved-imports: apps/web/src/server/framework-env.d.ts -> ../../.framework/types/server.d.ts",
];

const ruleByName = (config, name) => config.forbidden.find((rule) => rule.name === name);

test("empty serverEntryFiles and generatedDeclarationFiles leave the config as it was", () => {
  const plain = layout({ scope: "@acme/" });
  assert.deepEqual(
    layout({ scope: "@acme/", serverEntryFiles: [], generatedDeclarationFiles: [] }),
    plain,
  );
  assert.deepEqual(ruleByName(plain, "delivery-does-not-import-server").to, {
    path: "^apps/[^/]+/src/server(?:/|$)",
  });
  assert.deepEqual(ruleByName(plain, "no-unresolved-imports").from, {});
});

test("without the options, delivery may not import the server and declaration imports must resolve", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("web-app", layout({ scope: "@acme/" }))),
    DEFAULT_VIOLATIONS,
  );
});

test("serverEntryFiles lets delivery import only the named server files", async () => {
  const config = layout({ scope: "@acme/", serverEntryFiles: ["runtime/index.ts"] });
  assert.deepEqual(ruleByName(config, "delivery-does-not-import-server").to, {
    path: "^apps/[^/]+/src/server(?:/|$)",
    pathNot: "^apps/[^/]+/src/server/(?:runtime/index[.]ts)$",
  });
  assert.deepEqual(fromPaths(await violatedRules("web-app", config)), [
    DEFAULT_VIOLATIONS[0],
    ...DEFAULT_VIOLATIONS.slice(2),
  ]);
  const server = ruleByName(config, "server-does-not-import-delivery");
  assert.deepEqual(server, ruleByName(layout({ scope: "@acme/" }), server.name));
});

test("serverEntryFiles follows a renamed server layer", () => {
  const config = layout({
    scope: "@acme/",
    layers: { server: "backend" },
    serverEntryFiles: ["runtime.ts", "shared-runtime.ts"],
  });
  assert.equal(
    ruleByName(config, "delivery-does-not-import-server").to.pathNot,
    "^apps/[^/]+/src/backend/(?:runtime[.]ts|shared-runtime[.]ts)$",
  );
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

test("both options together leave only the real violations", async () => {
  const config = layout({
    scope: "@acme/",
    serverEntryFiles: ["runtime/index.ts"],
    generatedDeclarationFiles: ["framework-env.d.ts", "src/server/framework-env.d.ts"],
  });
  assert.deepEqual(fromPaths(await violatedRules("web-app", config)), [DEFAULT_VIOLATIONS[0]]);
});

test("serverEntryFiles and generatedDeclarationFiles validate their paths", () => {
  for (const bad of [
    "runtime.ts",
    [""],
    ["/runtime.ts"],
    ["runtime/"],
    ["../delivery/x.ts"],
    [1],
  ]) {
    assert.throws(
      () => layout({ scope: "@acme/", serverEntryFiles: bad }),
      /serverEntryFiles must be an array of relative paths/,
    );
  }
  for (const bad of [["framework-env.ts"], ["src/app.tsx"], ["types.d.ts/"], "env.d.ts"]) {
    assert.throws(
      () => layout({ scope: "@acme/", generatedDeclarationFiles: bad }),
      /generatedDeclarationFiles must be an array of relative paths .*ending in "\.d\.ts"/,
    );
  }
  assert.doesNotThrow(() =>
    layout({ scope: "@acme/", generatedDeclarationFiles: ["env.d.mts", ".gen/routes.d.cts"] }),
  );
});
