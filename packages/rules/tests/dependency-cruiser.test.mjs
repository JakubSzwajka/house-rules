import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import preset, { layout } from "../src/dependency-cruiser.cjs";
import { FIXTURES, fromPaths, ruleNames, violatedRules } from "./dependency-cruiser-helpers.mjs";

const require = createRequire(import.meta.url);
const fixtureLayout = (options = {}) => layout({ scope: "@acme/", ...options });
const retained = [
  "no-cycles",
  "packages-do-not-import-apps",
  "apps-do-not-import-other-apps",
  "packages-imported-by-name",
  "packages-public-entry-only",
  "contract-entry-is-browser-safe",
  "no-unresolved-deep-package-imports",
  "production-does-not-import-tests",
  "tests-live-in-tests-dir",
  "tests-do-not-import-internals",
  "no-unresolved-imports",
  "no-ownerless-files",
  "package-root-files",
  "domain-does-not-import-adapters",
  "subjects-do-not-import-package-root",
  "adapter-imports-only-in-adapters",
];
const also = {
  "no-unresolved-deep-package-imports": ["no-unresolved-imports"],
  "tests-do-not-import-internals": ["no-ownerless-files"],
  "domain-does-not-import-adapters": ["production-does-not-import-tests"],
};

test("layout snapshot pins every rule and error severity", async () => {
  const config = layout({ scope: "@acme/" });
  assert.deepEqual(
    config,
    JSON.parse(await readFile(path.join(FIXTURES, "layout-acme.snapshot.json"), "utf8")),
  );
  assert.deepEqual(
    config.forbidden.map(({ name, severity }) => [name, severity]),
    [
      "no-cycles",
      "packages-do-not-import-apps",
      "apps-do-not-import-other-apps",
      "packages-imported-by-name",
      "packages-public-entry-only",
      "contract-entry-is-browser-safe",
      "features-do-not-import-outer-folders",
      "read-models-import-packages-only",
      "ways-in-import-app-folders-only",
      "ways-in-do-not-import-read-model-values",
      "ways-in-import-contracts-only",
      "ways-in-import-contracts-only",
      "ways-in-do-not-import-other-ways",
      "composition-does-not-import-ways-in",
      "read-models-public-entry-only",
      "domain-imports-no-house-rules",
      "no-unresolved-deep-package-imports",
      "production-does-not-import-tests",
      "tests-live-in-tests-dir",
      "tests-do-not-import-internals",
      "no-unresolved-imports",
      "app-folders",
      "no-ownerless-files",
      "package-root-files",
      "package-root-files",
      "domain-does-not-import-adapters",
      "domain-does-not-import-adapters",
      "subjects-do-not-import-package-root",
      "adapter-imports-only-in-adapters",
      "contract-entry-is-browser-safe",
      "domain-does-not-import-adapters",
      "domain-does-not-import-adapters",
      "subjects-do-not-import-package-root",
      "adapter-imports-only-in-adapters",
    ].map((name) => [name, "error"]),
  );
});

test("layout exports, fresh values, exact options and custom roots", () => {
  assert.equal(preset.layout, layout);
  assert.equal(require("../src/dependency-cruiser.cjs").layout, layout);
  const first = layout({ scope: "@acme/" });
  first.forbidden.push({ name: "project-rule", from: {}, to: {} });
  assert.equal(layout({ scope: "@acme/" }).forbidden.length, first.forbidden.length - 1);
  assert.deepEqual(layout({ scope: "@acme" }), layout({ scope: "@acme/" }));
  const config = layout({
    scope: "@my.org/",
    appsDir: "services",
    packagesDir: "libs",
    layers: { features: "actions" },
    publicEntry: "src/main.ts",
    internalDir: "lib/private",
    testsDir: "spec",
  });
  const rule = (name) => config.forbidden.find((item) => item.name === name);
  assert.equal(
    rule("features-do-not-import-outer-folders").from.path,
    "^(services/[^/]+/src/actions/[^/]+)/",
  );
  assert.equal(
    rule("packages-public-entry-only").to.path,
    "^libs/[^/]+/(?!(?:src/main[.]ts|src/contract[.]ts)$)",
  );
  assert.equal(rule("no-unresolved-deep-package-imports").to.path, "^@my[.]org/[^/]+/.+");
  assert.equal(rule("tests-do-not-import-internals").to.path, "^libs/[^/]+/lib/private(?:/|$)");
  assert.equal(
    rule("tests-live-in-tests-dir").module.pathNot,
    "^(?:services|libs)/[^/]+/src/(?:spec|.*/spec)/[^/]+[.](?:test|spec)[.][^/]+$",
  );
  assert.equal(
    rule("production-does-not-import-tests").to.path,
    "(?:^|/)(?:tests?|__tests__|spec)(?:/|$)|[.](?:test|spec)[.][^/]+$",
  );
  assert.deepEqual(rule("app-folders").module.pathNot, [
    "^services/[^/]+/src/(?:actions|read-models|ways-in|composition)/",
    "^services/[^/]+/src/(?:main[.]ts|index[.]ts)$",
    "(?:^|/)(?:tests?|__tests__|spec)(?:/|$)|[.](?:test|spec)[.][^/]+$",
  ]);
  assert.equal(
    rule("ways-in-do-not-import-read-model-values").from.path,
    "^services/[^/]+/src/ways-in(?:/|$)",
  );
  const mechanisms =
    "[tT][yY][pP][eE][sS]|[mM][oO][dD][eE][lL][sS]|[sS][cC][hH][eE][mM][aA][sS]|[dD][rR][aA][fF][tT][sS]|[eE][rR][rR][oO][rR][sS]|[vV][aA][lL][iI][dD][aA][tT][eE]|[vV][aA][lL][iI][dD][aA][tT][iI][oO][nN]|[cC][oO][nN][sS][tT][aA][nN][tT][sS]|[iI][nN][tT][eE][rR][fF][aA][cC][eE][sS]|[iI][nN][tT][eE][rR][nN][aA][lL]";
  assert.deepEqual(rule("no-ownerless-files").module.path, [
    "^(?:services|libs)/(?:.*/)?(?:utils|helpers|misc)(?:[.][^/]*)?(?:/|$)",
    `^libs/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
    `^services/[^/]+/src/read-models/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
  ]);
  const named = layout({
    scope: "@acme/",
    appEntryFiles: ["worker.ts", "app.config.ts"],
    ownerlessNames: ["common", "lib"],
  }).forbidden;
  assert.equal(
    named.find(({ name }) => name === "app-folders").module.pathNot[1],
    "^apps/[^/]+/src/(?:worker[.]ts|app[.]config[.]ts)$",
  );
  assert.deepEqual(named.find(({ name }) => name === "no-ownerless-files").module.path, [
    "^(?:apps|packages)/(?:.*/)?(?:common|lib)(?:[.][^/]*)?(?:/|$)",
    `^packages/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
    `^apps/[^/]+/src/read-models/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
  ]);
  assert.deepEqual(
    layout({ scope: "@acme/", appEntryFiles: [] }).forbidden.find(
      ({ name }) => name === "app-folders",
    ).module.pathNot,
    [
      "^apps/[^/]+/src/(?:features|read-models|ways-in|composition)/",
      "(?:^|/)(?:tests?|__tests__)(?:/|$)|[.](?:test|spec)[.][^/]+$",
    ],
  );
  assert.throws(() => layout(), /scope is required/);
  assert.throws(() => layout({ scope: "" }), /scope is required/);
  for (const layers of [
    { delivery: "delivery" },
    { server: "server" },
    { useCases: "use-cases" },
    { domain: "domain" },
  ])
    assert.throws(() => layout({ scope: "@acme/", layers }), {
      name: "TypeError",
      message: `layout(): unknown layer "${Object.keys(layers)[0]}". Known layers: features, readModels, waysIn, composition.`,
    });
  for (const [options, message] of [
    [{ layer: {} }, /unknown option "layer"/u],
    [
      { appsDir: "apps/" },
      /appsDir must be a non-empty relative path without a leading or trailing/u,
    ],
    [{ layers: { features: "" } }, /layers.features must be a non-empty relative path/u],
    [{ appEntryFiles: "main.ts" }, /appEntryFiles must be an array of names without/u],
    [{ appEntryFiles: ["src/main.ts"] }, /appEntryFiles must be an array of names without/u],
    [{ ownerlessNames: [] }, /ownerlessNames must be a non-empty array of names without/u],
    [{ ownerlessNames: [""] }, /ownerlessNames must be a non-empty array of names without/u],
  ])
    assert.throws(() => layout({ scope: "@acme/", ...options }), message);
});

test("the preset loads only its own CJS siblings, never optional peers", () => {
  const directory = path.resolve(import.meta.dirname, "../src");
  const loaded = execFileSync(
    process.execPath,
    [
      "-e",
      'require("./src/dependency-cruiser.cjs"); console.log(JSON.stringify(Object.keys(require.cache)));',
    ],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.deepEqual(
    JSON.parse(loaded)
      .map((file) => path.relative(directory, file))
      .sort(),
    ["dependency-cruiser.cjs", "hosts.cjs", "layout-option-parsers.cjs", "layout-patterns.cjs"],
  );
});

for (const name of retained)
  test(`${name} retains its passing/failing fixture intent`, async () => {
    const violations = await violatedRules(`violations/${name}`, fixtureLayout());
    assert.deepEqual(
      ruleNames(violations),
      [name, ...(also[name] ?? [])].sort(),
      JSON.stringify(violations),
    );
  });

test("test placement still catches every misplaced test, even without workspace imports", async () => {
  const violations = await violatedRules("violations/tests-live-in-tests-dir", fixtureLayout());
  assert.deepEqual(violations.map(({ rule, from }) => `${rule}: ${from}`).sort(), [
    "tests-live-in-tests-dir: apps/web/src/ways-in/route.test.ts",
    "tests-live-in-tests-dir: packages/a/src/beside.test.ts",
    "tests-live-in-tests-dir: packages/a/src/tests/unit/nested.test.ts",
    "tests-live-in-tests-dir: packages/a/src/unit-tests/suffix.spec.ts",
    "tests-live-in-tests-dir: packages/a/tests/package-root.test.ts",
  ]);
});

test("app-folders rejects loose app files and custom entry lists stay exact", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("violations/app-code-in-layers", fixtureLayout())),
    ["app-folders: apps/web/src/delivery-legacy/bridge.ts", "app-folders: apps/web/src/stray.ts"],
  );
  assert.deepEqual(
    fromPaths(
      await violatedRules(
        "violations/app-code-in-layers",
        fixtureLayout({ appEntryFiles: ["stray.ts"] }),
      ),
    ),
    ["app-folders: apps/web/src/delivery-legacy/bridge.ts", "app-folders: apps/web/src/main.ts"],
  );
});

test("ownerless names stay whole-name, caseless for mechanisms, and configurable", async () => {
  const all = fromPaths(await violatedRules("violations/no-ownerless-files", fixtureLayout()));
  assert.deepEqual(all, [
    "no-ownerless-files: apps/web/src/ways-in/helpers/format.ts",
    "no-ownerless-files: apps/web/src/ways-in/misc.tsx",
    "no-ownerless-files: packages/a/src/Validation/rules.ts",
    "no-ownerless-files: packages/a/src/booking/Models.ts",
    "no-ownerless-files: packages/a/src/booking/constants.ts",
    "no-ownerless-files: packages/a/src/booking/types.ts",
    "no-ownerless-files: packages/a/src/errors/booking-not-found.ts",
    "no-ownerless-files: packages/a/src/internal/watch.ts",
    "no-ownerless-files: packages/a/src/text/utils.ts",
  ]);
  const named = fromPaths(
    await violatedRules(
      "violations/no-ownerless-files",
      fixtureLayout({ ownerlessNames: ["shared"] }),
    ),
  );
  assert.deepEqual(named, [
    "no-ownerless-files: apps/web/src/ways-in/shared.ts",
    "no-ownerless-files: packages/a/src/Validation/rules.ts",
    "no-ownerless-files: packages/a/src/booking/Models.ts",
    "no-ownerless-files: packages/a/src/booking/constants.ts",
    "no-ownerless-files: packages/a/src/booking/types.ts",
    "no-ownerless-files: packages/a/src/errors/booking-not-found.ts",
    "no-ownerless-files: packages/a/src/internal/watch.ts",
  ]);
});
