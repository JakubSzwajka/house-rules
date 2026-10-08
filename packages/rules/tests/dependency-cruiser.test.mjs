import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import preset, { layout } from "../src/dependency-cruiser.cjs";
import { FIXTURES, fromPaths, ruleNames, violatedRules } from "./dependency-cruiser-helpers.mjs";

const require = createRequire(import.meta.url);
const RULES = [
  "no-cycles",
  "packages-do-not-import-apps",
  "apps-do-not-import-other-apps",
  "packages-imported-by-name",
  "packages-public-entry-only",
  "delivery-does-not-import-server",
  "server-does-not-import-delivery",
  "use-cases-do-not-import-outer-layers",
  "no-unresolved-deep-package-imports",
  "production-does-not-import-tests",
  "tests-live-in-tests-dir",
  "tests-do-not-import-internals",
  "no-unresolved-imports",
  "app-code-in-layers",
  "use-cases-do-not-import-use-cases",
  "no-ownerless-files",
  "package-root-files",
  "domain-does-not-import-adapters",
  "subjects-do-not-import-package-root",
  "no-subject-folder-cycles",
  "adapter-imports-only-in-adapters",
];
// An unresolvable deep import is also an unresolved import; both rules are meant to fire.
// The default internalDir, src/internal, is also a mechanism name, so its fixture trips both rules.
const ALSO_FIRES = {
  "no-unresolved-deep-package-imports": ["no-unresolved-imports"],
  "tests-do-not-import-internals": ["no-ownerless-files"],
};

// Refresh after an intentional rule change:
// node -e 'console.log(JSON.stringify(require("./src/dependency-cruiser.cjs").layout({ scope: "@hosti/" }), null, 2))' > tests/fixtures/dependency-cruiser/layout-hosti.snapshot.json
test("layout() with drunk-cat-stack's scope matches the snapshot", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(FIXTURES, "layout-hosti.snapshot.json"), "utf8"),
  );
  const config = layout({ scope: "@hosti/" });
  assert.deepEqual(config, snapshot);
  assert.deepEqual(
    config.forbidden.map(({ name, severity }) => [name, severity]),
    RULES.map((name) => [name, "error"]),
  );
});

test("layout() is exported for require and import, returns a fresh config, and validates options", () => {
  assert.equal(preset.layout, layout);
  assert.equal(require("../src/dependency-cruiser.cjs").layout, layout);
  const first = layout({ scope: "@acme/" });
  first.forbidden.push({ name: "project-rule", from: {}, to: {} });
  assert.equal(layout({ scope: "@acme/" }).forbidden.length, RULES.length);
  assert.deepEqual(layout({ scope: "@acme" }).forbidden, layout({ scope: "@acme/" }).forbidden);

  const renamed = layout({
    scope: "@my.org/",
    appsDir: "services",
    packagesDir: "libs",
    layers: { useCases: "application" },
    publicEntry: "src/main.ts",
    internalDir: "lib/private",
    testsDir: "spec",
  });
  const byName = Object.fromEntries(renamed.forbidden.map((rule) => [rule.name, rule]));
  assert.equal(
    byName["use-cases-do-not-import-outer-layers"].from.path,
    "^services/[^/]+/src/application(?:/|$)",
  );
  assert.equal(
    byName["delivery-does-not-import-server"].from.path,
    "^services/[^/]+/src/delivery(?:/|$)",
  );
  assert.equal(byName["packages-public-entry-only"].to.path, "^libs/[^/]+/(?!src/main[.]ts$)");
  assert.equal(byName["no-unresolved-deep-package-imports"].to.path, "^@my[.]org/[^/]+/.+");
  assert.equal(byName["tests-do-not-import-internals"].to.path, "^libs/[^/]+/lib/private(?:/|$)");
  assert.equal(
    byName["tests-live-in-tests-dir"].module.pathNot,
    "^(?:services|libs)/[^/]+/src/(?:spec|.*/spec)/[^/]+[.](?:test|spec)[.][^/]+$",
  );
  assert.equal(
    byName["production-does-not-import-tests"].to.path,
    "(?:^|/)(?:tests?|__tests__|spec)(?:/|$)|[.](?:test|spec)[.][^/]+$",
  );
  assert.deepEqual(byName["app-code-in-layers"].module.pathNot.slice(0, 2), [
    "^services/[^/]+/src/(?:delivery|server|application)/",
    "^services/[^/]+/src/(?:main[.]ts|index[.]ts)$",
  ]);
  assert.equal(
    byName["use-cases-do-not-import-use-cases"].from.path,
    "^(services/[^/]+/src/application/[^/]+)",
  );
  assert.deepEqual(byName["no-ownerless-files"].module.path, [
    "^(?:services|libs)/(?:.*/)?(?:utils|helpers|misc)(?:[.][^/]*)?(?:/|$)",
    "^libs/[^/]+/(?:.*/)?(?:[tT][yY][pP][eE][sS]|[mM][oO][dD][eE][lL][sS]|[sS][cC][hH][eE][mM][aA][sS]|[dD][rR][aA][fF][tT][sS]|[eE][rR][rR][oO][rR][sS]|[vV][aA][lL][iI][dD][aA][tT][eE]|[vV][aA][lL][iI][dD][aA][tT][iI][oO][nN]|[cC][oO][nN][sS][tT][aA][nN][tT][sS]|[iI][nN][tT][eE][rR][fF][aA][cC][eE][sS]|[iI][nN][tT][eE][rR][nN][aA][lL])(?:[.][^/]*)?(?:/|$)",
  ]);
  const named = Object.fromEntries(
    layout({
      scope: "@acme/",
      appEntryFiles: ["server.ts", "app.config.ts"],
      ownerlessNames: ["common", "lib"],
    }).forbidden.map((rule) => [rule.name, rule]),
  );
  assert.equal(
    named["app-code-in-layers"].module.pathNot[1],
    "^apps/[^/]+/src/(?:server[.]ts|app[.]config[.]ts)$",
  );
  assert.deepEqual(named["no-ownerless-files"].module.path, [
    "^(?:apps|packages)/(?:.*/)?(?:common|lib)(?:[.][^/]*)?(?:/|$)",
    "^packages/[^/]+/(?:.*/)?(?:[tT][yY][pP][eE][sS]|[mM][oO][dD][eE][lL][sS]|[sS][cC][hH][eE][mM][aA][sS]|[dD][rR][aA][fF][tT][sS]|[eE][rR][rR][oO][rR][sS]|[vV][aA][lL][iI][dD][aA][tT][eE]|[vV][aA][lL][iI][dD][aA][tT][iI][oO][nN]|[cC][oO][nN][sS][tT][aA][nN][tT][sS]|[iI][nN][tT][eE][rR][fF][aA][cC][eE][sS]|[iI][nN][tT][eE][rR][nN][aA][lL])(?:[.][^/]*)?(?:/|$)",
  ]);
  assert.equal(
    layout({ scope: "@acme/", appEntryFiles: [] }).forbidden.find(
      (rule) => rule.name === "app-code-in-layers",
    ).module.pathNot.length,
    2,
  );

  assert.throws(() => layout(), /scope is required/);
  assert.throws(() => layout({ scope: "" }), /scope is required/);
  assert.throws(() => layout({ scope: "@acme/", layer: {} }), /unknown option "layer"/);
  assert.throws(
    () => layout({ scope: "@acme/", layers: { domain: "domain" } }),
    /unknown layer "domain"/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", appsDir: "apps/" }),
    /appsDir must be a non-empty relative path/,
  );
  assert.throws(() => layout({ scope: "@acme/", layers: { server: "" } }), /layers.server must be/);
  assert.throws(
    () => layout({ scope: "@acme/", appEntryFiles: "main.ts" }),
    /appEntryFiles must be an array/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", appEntryFiles: ["src/main.ts"] }),
    /appEntryFiles must be an array/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", ownerlessNames: [] }),
    /ownerlessNames must be a non-empty array/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", ownerlessNames: [""] }),
    /ownerlessNames must be a non-empty array/,
  );
});

test("the preset loads no other module", () => {
  const loaded = execFileSync(
    process.execPath,
    [
      "-e",
      'require("./src/dependency-cruiser.cjs"); console.log(JSON.stringify(Object.keys(require.cache)));',
    ],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(loaded), [
    path.resolve(import.meta.dirname, "../src/dependency-cruiser.cjs"),
  ]);
});

test("a clean workspace has no violations", async () => {
  assert.deepEqual(await violatedRules("clean", layout({ scope: "@acme/" })), []);
});

test("tests-live-in-tests-dir reports every misplaced test, including ones with no workspace imports", async () => {
  const violations = await violatedRules(
    "violations/tests-live-in-tests-dir",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(violations.map(({ rule, from }) => `${rule}: ${from}`).sort(), [
    "tests-live-in-tests-dir: apps/web/src/delivery/route.test.ts",
    "tests-live-in-tests-dir: packages/a/src/beside.test.ts",
    "tests-live-in-tests-dir: packages/a/src/tests/unit/nested.test.ts",
    "tests-live-in-tests-dir: packages/a/src/unit-tests/suffix.spec.ts",
    "tests-live-in-tests-dir: packages/a/tests/package-root.test.ts",
  ]);
});

for (const name of RULES) {
  test(`${name} fires on its fixture`, async () => {
    const violations = await violatedRules(`violations/${name}`, layout({ scope: "@acme/" }));
    assert.deepEqual(
      ruleNames(violations),
      [name, ...(ALSO_FIRES[name] ?? [])].sort(),
      JSON.stringify(violations),
    );
  });
}

test("the violation fixtures cover every rule and nothing else", async () => {
  assert.deepEqual((await readdir(path.join(FIXTURES, "violations"))).sort(), [...RULES].sort());
});

test("app-code-in-layers reports app files outside the layers, and not entry files or tests", async () => {
  const violations = await violatedRules(
    "violations/app-code-in-layers",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "app-code-in-layers: apps/web/src/delivery-legacy/bridge.ts",
    "app-code-in-layers: apps/web/src/stray.ts",
  ]);
});

test("appEntryFiles changes which files may sit directly in src/", async () => {
  const violations = await violatedRules(
    "violations/app-code-in-layers",
    layout({ scope: "@acme/", appEntryFiles: ["stray.ts"] }),
  );
  assert.deepEqual(fromPaths(violations), [
    "app-code-in-layers: apps/web/src/delivery-legacy/bridge.ts",
    "app-code-in-layers: apps/web/src/main.ts",
  ]);
});

test("use-cases-do-not-import-use-cases reports imports across use-case entries only", async () => {
  const violations = await violatedRules(
    "violations/use-cases-do-not-import-use-cases",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "use-cases-do-not-import-use-cases: apps/web/src/use-cases/book.ts -> apps/web/src/use-cases/cancel/index.ts",
    "use-cases-do-not-import-use-cases: apps/web/src/use-cases/refund.ts -> apps/web/src/use-cases/cancel/policy.ts",
  ]);
});

test("no-ownerless-files reports ownerless names anywhere and mechanism names in packages, by whole name in any letter case", async () => {
  const violations = await violatedRules(
    "violations/no-ownerless-files",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "no-ownerless-files: apps/web/src/delivery/helpers/format.ts",
    "no-ownerless-files: apps/web/src/delivery/misc.tsx",
    "no-ownerless-files: packages/a/src/Validation/rules.ts",
    "no-ownerless-files: packages/a/src/booking/Models.ts",
    "no-ownerless-files: packages/a/src/booking/constants.ts",
    "no-ownerless-files: packages/a/src/booking/types.ts",
    "no-ownerless-files: packages/a/src/errors/booking-not-found.ts",
    "no-ownerless-files: packages/a/src/internal/watch.ts",
    "no-ownerless-files: packages/a/src/text/utils.ts",
  ]);
});

test("ownerlessNames replaces the default names", async () => {
  const violations = await violatedRules(
    "violations/no-ownerless-files",
    layout({ scope: "@acme/", ownerlessNames: ["shared"] }),
  );
  assert.deepEqual(fromPaths(violations), [
    "no-ownerless-files: apps/web/src/delivery/shared.ts",
    "no-ownerless-files: packages/a/src/Validation/rules.ts",
    "no-ownerless-files: packages/a/src/booking/Models.ts",
    "no-ownerless-files: packages/a/src/booking/constants.ts",
    "no-ownerless-files: packages/a/src/booking/types.ts",
    "no-ownerless-files: packages/a/src/errors/booking-not-found.ts",
    "no-ownerless-files: packages/a/src/internal/watch.ts",
  ]);
});

test("renaming layers.useCases moves the use-cases rules to the new folder", async () => {
  assert.deepEqual(fromPaths(await violatedRules("renamed-layers", layout({ scope: "@acme/" }))), [
    "app-code-in-layers: apps/web/src/application/show.ts",
  ]);
  assert.deepEqual(
    await violatedRules(
      "renamed-layers",
      layout({ scope: "@acme/", layers: { useCases: "application" } }),
    ),
    [
      {
        rule: "use-cases-do-not-import-outer-layers",
        from: "apps/web/src/application/show.ts",
        to: "apps/web/src/delivery/route.ts",
      },
    ],
  );
});
