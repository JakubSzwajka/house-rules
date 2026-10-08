import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { findSubjectFolderCycles } from "../src/subject-folder-cycles.mjs";
import { cruiseFixture, fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

// The package checks: mechanism names (part of no-ownerless-files), package-root-files,
// domain-does-not-import-adapters, subjects-do-not-import-package-root and no-subject-folder-cycles.
test("the package layout rules build their patterns from the options", () => {
  const byName = Object.fromEntries(
    layout({
      scope: "@my.org/",
      packagesDir: "libs",
      publicEntry: "src/main.ts",
    }).forbidden.map((rule) => [rule.name, rule]),
  );
  assert.equal(byName["package-root-files"].module.path, "^libs/[^/]+/src/[^/]+$");
  assert.equal(
    byName["package-root-files"].module.pathNot[0],
    "^libs/[^/]+/src/(?:index[.]ts|facade[.]ts|storage[.]ts)$",
  );
  const adapterRules = layout({
    scope: "@my.org/",
    packagesDir: "libs",
    publicEntry: "src/main.ts",
  }).forbidden.filter((rule) => rule.name === "domain-does-not-import-adapters");
  assert.deepEqual(adapterRules[0].from, {
    path: "^(libs/[^/]+)/src/",
    pathNot: [
      "^libs/[^/]+/src/adapters(?:/|$)",
      "^libs/[^/]+/src/main[.]ts$",
      "^libs/[^/]+/src/facade[.]ts$",
    ],
  });
  assert.deepEqual(adapterRules[0].to, {
    path: "^$1/src/adapters(?:/|$)",
    pathNot: "^$1/src/adapters/tests(?:/|$)",
  });
  assert.deepEqual(adapterRules[1].from, {
    path: "^(libs/[^/]+)/src/",
    pathNot: [
      "^libs/[^/]+/src/adapters(?:/|$)",
      "^libs/[^/]+/src/main[.]ts$",
      "^libs/[^/]+/src/facade[.]ts$",
      "(?:^|/)(?:tests?|__tests__)(?:/|$)|[.](?:test|spec)[.][^/]+$",
    ],
  });
  assert.deepEqual(adapterRules[1].to, { path: "^$1/src/adapters/tests(?:/|$)" });
  assert.deepEqual(byName["subjects-do-not-import-package-root"].to, {
    path: "^$1/(?:src/main[.]ts|src/facade[.]ts)$",
  });
  assert.equal(byName["no-subject-folder-cycles"], undefined);

  const custom = Object.fromEntries(
    layout({
      scope: "@acme/",
      mechanismNames: ["dto"],
      packageRootFiles: ["index.ts", "service.ts"],
      facadeFile: "src/service.ts",
    }).forbidden.map((rule) => [rule.name, rule]),
  );
  assert.equal(
    custom["no-ownerless-files"].module.path[1],
    "^packages/[^/]+/(?:.*/)?(?:[dD][tT][oO])(?:[.][^/]*)?(?:/|$)",
  );
  assert.equal(
    custom["package-root-files"].module.pathNot[0],
    "^packages/[^/]+/src/(?:index[.]ts|service[.]ts)$",
  );
  assert.equal(
    custom["domain-does-not-import-adapters"].from.pathNot[2],
    "^packages/[^/]+/src/service[.]ts$",
  );
  assert.deepEqual(
    layout({ scope: "@acme/", mechanismNames: [] }).forbidden.find(
      (rule) => rule.name === "no-ownerless-files",
    ).module.path,
    ["^(?:apps|packages)/(?:.*/)?(?:utils|helpers|misc)(?:[.][^/]*)?(?:/|$)"],
  );
  assert.throws(
    () => layout({ scope: "@acme/", mechanismNames: ["src/types"] }),
    /mechanismNames must be an array/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", packageRootFiles: [] }),
    /packageRootFiles must be a non-empty array/,
  );
  assert.throws(
    () => layout({ scope: "@acme/", facadeFile: "/src/facade.ts" }),
    /facadeFile must be a non-empty relative path/,
  );
});

test("mechanismNames replaces the package-only names, and [] turns them off", async () => {
  const fixture = "violations/no-ownerless-files";
  const ownerless = [
    "no-ownerless-files: apps/web/src/delivery/helpers/format.ts",
    "no-ownerless-files: apps/web/src/delivery/misc.tsx",
    "no-ownerless-files: packages/a/src/text/utils.ts",
  ];
  assert.deepEqual(
    fromPaths(await violatedRules(fixture, layout({ scope: "@acme/", mechanismNames: [] }))),
    ownerless,
  );
  assert.deepEqual(
    fromPaths(
      await violatedRules(fixture, layout({ scope: "@acme/", mechanismNames: ["item-errors"] })),
    ),
    [...ownerless, "no-ownerless-files: packages/a/src/booking/item-errors.ts"].sort(),
  );
});

test("mechanism names match in any letter case, and internal is one by default", async () => {
  const violations = await violatedRules(
    "violations/no-ownerless-files",
    layout({ scope: "@acme/", mechanismNames: ["models", "validation"] }),
  );
  assert.deepEqual(
    fromPaths(violations).filter(
      (line) => line.includes("/Models.ts") || line.includes("/Validation/"),
    ),
    [
      "no-ownerless-files: packages/a/src/Validation/rules.ts",
      "no-ownerless-files: packages/a/src/booking/Models.ts",
    ],
  );
  assert.ok(
    fromPaths(
      await violatedRules("violations/no-ownerless-files", layout({ scope: "@acme/" })),
    ).includes("no-ownerless-files: packages/a/src/internal/watch.ts"),
  );
  assert.ok(
    !fromPaths(
      await violatedRules(
        "violations/no-ownerless-files",
        layout({ scope: "@acme/", mechanismNames: ["types"] }),
      ),
    ).includes("no-ownerless-files: packages/a/src/internal/watch.ts"),
  );
});

test("package-root-files reports a loose file in a package's src/, not the entry files, folders or tests", async () => {
  const violations = await violatedRules(
    "violations/package-root-files",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), ["package-root-files: packages/a/src/stray.ts"]);
  const renamed = await violatedRules(
    "violations/package-root-files",
    layout({ scope: "@acme/", packageRootFiles: ["index.ts", "stray.ts"] }),
  );
  assert.deepEqual(fromPaths(renamed), [
    "package-root-files: packages/a/src/facade.ts",
    "package-root-files: packages/a/src/storage.ts",
  ]);
});

test("domain-does-not-import-adapters allows test support only from tests", async () => {
  const violations = await violatedRules(
    "violations/domain-does-not-import-adapters",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "domain-does-not-import-adapters: packages/a/src/booking/describe.ts -> packages/a/src/adapters/tests/support.ts",
    "domain-does-not-import-adapters: packages/a/src/storage.ts -> packages/a/src/adapters/memory/booking.ts",
    "domain-does-not-import-adapters: packages/a/src/tests/bookings.test.ts -> packages/a/src/adapters/memory/booking.ts",
    "domain-does-not-import-adapters: packages/a/src/tests/bookings.test.ts -> packages/a/src/adapters/postgres/booking.ts",
    "production-does-not-import-tests: packages/a/src/booking/describe.ts -> packages/a/src/adapters/tests/support.ts",
  ]);
});

test("no-subject-folder-cycles catches a production cycle that crosses files", async () => {
  const config = layout({ scope: "@acme/" });
  const { modules } = await cruiseFixture(
    "subject-folder-cycles/production-two-folder-cycle",
    config,
  );
  const cycles = findSubjectFolderCycles(modules, config);
  assert.deepEqual(
    cycles.map(({ cycle }) => cycle.join(" -> ")),
    ["packages/a/src/items -> packages/a/src/places -> packages/a/src/items"],
  );
  assert.deepEqual(cycles[0].examples, [
    {
      fromFolder: "packages/a/src/items",
      toFolder: "packages/a/src/places",
      from: "packages/a/src/items/item.ts",
      to: "packages/a/src/places/place-id.ts",
    },
    {
      fromFolder: "packages/a/src/places",
      toFolder: "packages/a/src/items",
      from: "packages/a/src/places/place.ts",
      to: "packages/a/src/items/item-ref.ts",
    },
  ]);
  const reversed = { ...config, forbidden: [...config.forbidden].reverse() };
  assert.deepEqual(findSubjectFolderCycles(modules, reversed), cycles);
});

test("no-subject-folder-cycles ignores the Trippy-shaped test-only route", async () => {
  const config = layout({ scope: "@acme/" });
  const { modules } = await cruiseFixture("no-subject-folder-test-cycles", config);
  assert.deepEqual(findSubjectFolderCycles(modules, config), []);
});

test("no-subject-folder-cycles catches a three-subject production cycle through tests-utils", async () => {
  const config = layout({ scope: "@acme/" });
  const { modules } = await cruiseFixture("no-subject-folder-three-cycles", config);
  assert.deepEqual(
    findSubjectFolderCycles(modules, config).map(({ cycle }) => cycle.join(" -> ")),
    [
      "packages/a/src/items -> packages/a/src/places -> packages/a/src/tests-utils -> packages/a/src/items",
    ],
  );
});

test("subjects-do-not-import-package-root reports a subject file that imports its package's index.ts or facade.ts", async () => {
  const fixture = "violations/subjects-do-not-import-package-root";
  assert.deepEqual(fromPaths(await violatedRules(fixture, layout({ scope: "@acme/" }))), [
    "subjects-do-not-import-package-root: packages/a/src/one/one.ts -> packages/a/src/index.ts",
    "subjects-do-not-import-package-root: packages/a/src/two/facade-user.ts -> packages/a/src/facade.ts",
  ]);
  // storage.ts and tests/ are not barrels the rule guards, and they pass in the default run above.
  // The cycle a/one.ts -> index.ts -> two/two-id.ts, two/two.ts -> one/one-id.ts is no file cycle
  // and the folder rule does not see it through the barrel: only this rule does.
  const only = await violatedRules(
    fixture,
    layout({ scope: "@acme/", facadeFile: "src/storage.ts" }),
  );
  assert.deepEqual(fromPaths(only), [
    "subjects-do-not-import-package-root: packages/a/src/one/one.ts -> packages/a/src/index.ts",
    "subjects-do-not-import-package-root: packages/a/src/one/one.ts -> packages/a/src/storage.ts",
    "subjects-do-not-import-package-root: packages/a/src/two/two.ts -> packages/a/src/storage.ts",
  ]);
});
