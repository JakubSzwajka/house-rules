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
      "no-unresolved-deep-package-imports",
      "production-does-not-import-tests",
      "tests-live-in-tests-dir",
      "tests-do-not-import-internals",
      "no-unresolved-imports",
      "no-ownerless-files",
      "package-root-files",
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
    publicEntry: "src/main.ts",
    internalDir: "lib/private",
    testsDir: "spec",
  });
  const rule = (name) => config.forbidden.find((item) => item.name === name);
  assert.equal(rule("packages-public-entry-only").to.path, "^libs/[^/]+/(?!src/main[.]ts$)");
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
  assert.equal(rule("subjects-do-not-import-package-root").to.path, "^$1/src/main[.]ts$");
  const mechanisms =
    "[tT][yY][pP][eE][sS]|[mM][oO][dD][eE][lL][sS]|[sS][cC][hH][eE][mM][aA][sS]|[dD][rR][aA][fF][tT][sS]|[eE][rR][rR][oO][rR][sS]|[vV][aA][lL][iI][dD][aA][tT][eE]|[vV][aA][lL][iI][dD][aA][tT][iI][oO][nN]|[cC][oO][nN][sS][tT][aA][nN][tT][sS]|[iI][nN][tT][eE][rR][fF][aA][cC][eE][sS]|[iI][nN][tT][eE][rR][nN][aA][lL]";
  assert.deepEqual(rule("no-ownerless-files").module.path, [
    "^(?:services|libs)/(?:.*/)?(?:utils|helpers|misc)(?:[.][^/]*)?(?:/|$)",
    `^libs/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
  ]);
  const named = layout({ scope: "@acme/", ownerlessNames: ["common", "lib"] }).forbidden;
  assert.deepEqual(named.find(({ name }) => name === "no-ownerless-files").module.path, [
    "^(?:apps|packages)/(?:.*/)?(?:common|lib)(?:[.][^/]*)?(?:/|$)",
    `^packages/[^/]+/(?:.*/)?(?:${mechanisms})(?:[.][^/]*)?(?:/|$)`,
  ]);
  assert.throws(() => layout(), /scope is required/);
  assert.throws(() => layout({ scope: "" }), /scope is required/);
  for (const option of ["layers", "appEntryFiles", "facadeFile", "trustedContractPackages"])
    assert.throws(() => layout({ scope: "@acme/", [option]: undefined }), {
      name: "TypeError",
      message: new RegExp(
        `^layout\\(\\): ${option} was removed with the retired house-rules kits`,
        "u",
      ),
    });
  for (const [options, message] of [
    [{ layer: {} }, /unknown option "layer"/u],
    [
      { appsDir: "apps/" },
      /appsDir must be a non-empty relative path without a leading or trailing/u,
    ],
    [{ ownerlessNames: [] }, /ownerlessNames must be a non-empty array of names without/u],
    [{ ownerlessNames: [""] }, /ownerlessNames must be a non-empty array of names without/u],
    [{ packageRootFiles: [] }, /packageRootFiles must be a non-empty array of names without/u],
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
