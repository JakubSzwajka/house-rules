import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

test("adapter-imports-only-in-adapters reports SQL and platform imports outside src/adapters/ of a package", async () => {
  const violations = await violatedRules(
    "violations/adapter-imports-only-in-adapters",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "adapter-imports-only-in-adapters: packages/db/src/index.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/tests/trips.test.ts -> node_modules/@effect/platform-node/dist/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/trips.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/SqlClient.js",
  ]);
});

test("adapterPackages, adapterImports and adapterImportsSeverity change the adapter rule", async () => {
  const fixture = "violations/adapter-imports-only-in-adapters";
  const named = await violatedRules(fixture, layout({ scope: "@acme/", adapterPackages: ["db"] }));
  assert.deepEqual(named.map(({ from }) => from).sort(), [
    "packages/trips/src/tests/trips.test.ts",
    "packages/trips/src/trips.ts",
  ]);
  const platformOnly = await violatedRules(
    fixture,
    layout({ scope: "@acme/", adapterImports: ["@effect/platform-*"] }),
  );
  assert.deepEqual(
    platformOnly.map(({ from }) => from),
    ["packages/trips/src/tests/trips.test.ts"],
  );

  const strict = layout({
    scope: "@acme/",
    adapterImportsSeverity: "error",
    adaptersDir: "src/storage",
  });
  const rule = strict.forbidden.find(({ name }) => name === "adapter-imports-only-in-adapters");
  assert.equal(rule.severity, "error");
  assert.deepEqual(rule.from.pathNot, ["^packages/[^/]+/src/storage(?:/|$)"]);
  assert.deepEqual(
    layout({ scope: "@acme/", adapterImports: ["pg", "@scope/name/sub/*"] }).forbidden.at(-1).to
      .path,
    ["(?:^|/)node_modules/pg/", "(?:^|/)node_modules/@scope/name/(?:[^/]+/|)sub/[^/]*(?:[/.]|$)"],
  );

  assert.throws(
    () => layout({ scope: "@acme/", adapterImportsSeverity: "loud" }),
    /adapterImportsSeverity must be one of error, warn, info/,
  );
  for (const adapterImports of [[], ["./local"], ["/abs"], "effect", ["effect/"]]) {
    assert.throws(
      () => layout({ scope: "@acme/", adapterImports }),
      /adapterImports must be a non-empty array of bare import specifiers/,
    );
  }
  assert.throws(
    () => layout({ scope: "@acme/", adapterPackages: ["packages/db"] }),
    /adapterPackages must be an array of names/,
  );
});

test("the exclude pattern skips build output in the workspace, and keeps node_modules in the graph", () => {
  const exclude = new RegExp(layout({ scope: "@acme/" }).options.exclude.path);
  for (const skipped of [
    "dist/index.js",
    "apps/web/dist/index.js",
    "packages/a/src/generated/client.ts",
    "packages/a/coverage/x.js",
    ".turbo/cache",
    ".agent_sources/github.com/x.ts",
  ]) {
    assert.ok(exclude.test(skipped), skipped);
  }
  for (const kept of [
    "node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/index.js",
    "node_modules/@effect/sql-pg/dist/index.js",
    "packages/a/src/distance.ts",
  ]) {
    assert.ok(!exclude.test(kept), kept);
  }
});
