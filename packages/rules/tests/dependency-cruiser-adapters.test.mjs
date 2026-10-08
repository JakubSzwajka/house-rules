import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ADAPTER_IMPORTS, layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

test("adapter-imports-only-in-adapters reports SQL and platform imports outside src/adapters/ of a package", async () => {
  const violations = await violatedRules(
    "violations/adapter-imports-only-in-adapters",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "adapter-imports-only-in-adapters: packages/db/src/index.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/tests/trips.test.ts -> node_modules/@effect/platform-node/dist/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/trip/trips.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/SqlClient.js",
  ]);
});

test("adapter-imports-only-in-adapters is always an error, and adapterImportsSeverity is rejected", () => {
  const rule = layout({ scope: "@acme/" }).forbidden.find(
    ({ name }) => name === "adapter-imports-only-in-adapters",
  );
  assert.equal(rule.severity, "error");
  for (const adapterImportsSeverity of ["error", "warn", "info", undefined]) {
    assert.throws(
      () => layout({ scope: "@acme/", adapterImportsSeverity }),
      /adapterImportsSeverity was removed in 0[.]8[.]0[.] adapter-imports-only-in-adapters is always an error/,
    );
  }
});

test("a workspace package in adapterImports fences a domain file that imports it", async () => {
  const fixture = "violations/adapter-imports-only-in-adapters";
  const adapterImports = [...DEFAULT_ADAPTER_IMPORTS, "@acme/db"];
  const fenced = await violatedRules(fixture, layout({ scope: "@acme/", adapterImports }));
  assert.deepEqual(fromPaths(fenced), [
    "adapter-imports-only-in-adapters: packages/db/src/index.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/tests/trips.test.ts -> node_modules/@effect/platform-node/dist/index.js",
    "adapter-imports-only-in-adapters: packages/trips/src/trip/trip-count.ts -> packages/db/src/index.ts",
    "adapter-imports-only-in-adapters: packages/trips/src/trip/trips.ts -> node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/unstable/sql/SqlClient.js",
  ]);
  const plumbing = await violatedRules(
    fixture,
    layout({ scope: "@acme/", adapterImports, adapterPackages: ["db"] }),
  );
  assert.deepEqual(plumbing.map(({ from }) => from).sort(), [
    "packages/trips/src/tests/trips.test.ts",
    "packages/trips/src/trip/trip-count.ts",
    "packages/trips/src/trip/trips.ts",
  ]);
});

test("a scoped adapterImports entry matches its workspace folder and its node_modules path", () => {
  assert.deepEqual(DEFAULT_ADAPTER_IMPORTS, [
    "effect/unstable/sql",
    "@effect/sql-*",
    "@effect/platform-*",
  ]);
  assert.ok(Object.isFrozen(DEFAULT_ADAPTER_IMPORTS));
  const rule = layout({
    scope: "@acme",
    packagesDir: "libs",
    adapterImports: ["@acme/db", "@acme/sql-*/pool", "@other/db"],
  }).forbidden.filter(({ name }) => name === "adapter-imports-only-in-adapters");
  assert.deepEqual(
    rule.map(({ to }) => to),
    [
      {
        path: [
          "(?:^|/)node_modules/@acme/db/",
          "(?:^|/)node_modules/@acme/sql-[^/]*/(?:[^/]+/|)pool(?:[/.]|$)",
          "(?:^|/)node_modules/@other/db/",
        ],
      },
      { path: "^libs/db/" },
      { path: "^libs/sql-[^/]*/(?:[^/]+/|)pool(?:[/.]|$)" },
    ],
  );
  assert.deepEqual(
    rule.map(({ from }) => from.pathNot.at(-1)),
    [rule[0].from.pathNot.at(-1), "^libs/db/", "^libs/sql-[^/]*/"],
  );
  assert.equal(rule[0].from.path, "^libs/[^/]+/src/");
});

test("a listed package's own-folder exception is exact, so a dotted folder name is no wildcard", async () => {
  // dependency-cruiser exports no subpath for these internals, so import them by file URL.
  const internal = (file) => import(new URL(file, import.meta.resolve("dependency-cruiser")).href);
  const { default: normalize } = await internal("./rule-set/normalize.mjs");
  const { default: matcher } = await internal("../validate/match-dependency-rule.mjs");
  const rule = normalize(
    layout({ scope: "@acme/", adapterImports: [...DEFAULT_ADAPTER_IMPORTS, "@acme/db-tools"] }),
  ).forbidden.at(-1);
  const flagged = (source, resolved) =>
    matcher.match({ source }, { resolved, dependencyTypes: ["npm"] })(rule);
  assert.ok(flagged("packages/db.tools/src/index.ts", "packages/db-tools/src/index.ts"));
  assert.ok(flagged("packages/db/src/index.ts", "packages/db-tools/src/index.ts"));
  assert.ok(!flagged("packages/db-tools/src/index.ts", "packages/db-tools/src/pool.ts"));
});

test("adapterPackages and adapterImports change the adapter rule", async () => {
  const fixture = "violations/adapter-imports-only-in-adapters";
  const named = await violatedRules(fixture, layout({ scope: "@acme/", adapterPackages: ["db"] }));
  assert.deepEqual(named.map(({ from }) => from).sort(), [
    "packages/trips/src/tests/trips.test.ts",
    "packages/trips/src/trip/trips.ts",
  ]);
  const platformOnly = await violatedRules(
    fixture,
    layout({ scope: "@acme/", adapterImports: ["@effect/platform-*"] }),
  );
  assert.deepEqual(
    platformOnly.map(({ from }) => from),
    ["packages/trips/src/tests/trips.test.ts"],
  );

  const storage = layout({ scope: "@acme/", adaptersDir: "src/storage" });
  const rule = storage.forbidden.find(({ name }) => name === "adapter-imports-only-in-adapters");
  assert.deepEqual(rule.from.pathNot, ["^packages/[^/]+/src/storage(?:/|$)"]);
  assert.deepEqual(
    layout({ scope: "@acme/", adapterImports: ["pg", "@scope/name/sub/*"] }).forbidden.at(-1).to
      .path,
    ["(?:^|/)node_modules/pg/", "(?:^|/)node_modules/@scope/name/(?:[^/]+/|)sub/[^/]*(?:[/.]|$)"],
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
