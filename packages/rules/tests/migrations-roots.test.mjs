import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { problemLines, run, TRIPS_MIGRATION } from "./migrations-helpers.mjs";

const preset = fileURLToPath(new URL("../src/dependency-cruiser.cjs", import.meta.url));
// A workspace with an example beside the template's own apps and packages.
const EXAMPLE = {
  "pnpm-workspace.yaml": [
    "packages:",
    '  - "apps/*"',
    "  - packages/*",
    '  - "examples/*/apps/*"',
    '  - "examples/*/packages/*"',
    "",
  ].join("\n"),
  "examples/shop/apps/api/package.json": "{}",
  "examples/shop/packages/orders/package.json": "{}",
};
const ORDERS_MIGRATION = "create table orders (id text primary key);\n";
const layoutConfig = (options) =>
  `module.exports = require(${JSON.stringify(preset)}).layout(${JSON.stringify({ scope: "@acme/", ...options })});\n`;
const ROOTS = {
  appsDir: ["apps", "examples/*/apps"],
  packagesDir: ["packages", "examples/*/packages"],
};

describe("house-rules-migrations, with apps and packages in several roots", () => {
  it("accepts a nested workspace entry and runs its ownership checks", () => {
    const result = run({
      ...EXAMPLE,
      "examples/shop/packages/orders/migrations/0001_orders.sql": ORDERS_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "migrations.json": JSON.stringify({
        modules: [{ workspace: "packages/trips" }, { workspace: "examples/shop/packages/orders" }],
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 table\(s\) owned by 2 package\(s\).*2 module\(s\) listed/u);
  });

  it("fails a nested module with migrations that the list does not name", () => {
    const result = run({
      ...EXAMPLE,
      "examples/shop/packages/orders/migrations/0001_orders.sql": ORDERS_MIGRATION,
      "migrations.json": JSON.stringify({ modules: [] }),
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /examples\/shop\/packages\/orders has migrations, but the module list does not name it\. Add \{ "workspace": "examples\/shop\/packages\/orders" \}/u,
    );
  });

  it("fails a nested folder that pnpm-workspace.yaml does not list", () => {
    const result = run({
      "examples/shop/packages/orders/package.json": "{}",
      "examples/shop/packages/orders/migrations/0001_orders.sql": ORDERS_MIGRATION,
      "migrations.json": JSON.stringify({
        modules: [{ workspace: "examples/shop/packages/orders" }],
      }),
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /names workspace "examples\/shop\/packages\/orders", which is not a workspace package/u,
    );
  });

  it("reads the apps roots from the layout config, so a nested app's use-case may open a unit", () => {
    const files = {
      ...EXAMPLE,
      "examples/shop/apps/api/src/use-cases/place-order.ts":
        "export const run = UnitOfWork.atomic(work);\n",
      "examples/shop/packages/orders/src/facade.ts":
        "export const place = UnitOfWork.atomic(work);\n",
    };
    const withRoots = run({ ...files, ".dependency-cruiser.cjs": layoutConfig(ROOTS) });
    assert.equal(withRoots.status, 1);
    assert.deepEqual(problemLines(withRoots), ["examples/shop/packages/orders/src/facade.ts:1"]);

    // With the default roots, examples/ holds no app, so its use-case counts as module code.
    const withDefaults = run({ ...files, ".dependency-cruiser.cjs": layoutConfig({}) });
    assert.deepEqual(problemLines(withDefaults), [
      "examples/shop/apps/api/src/use-cases/place-order.ts:1",
      "examples/shop/packages/orders/src/facade.ts:1",
    ]);
    // No layout config: apps/ only, as before.
    assert.deepEqual(problemLines(run(files)), problemLines(withDefaults));
  });

  it("fails clearly when the layout config cannot be read or names no apps roots", () => {
    const broken = run({ ".dependency-cruiser.cjs": "module.exports = {;\n" });
    assert.equal(broken.status, 1);
    assert.match(
      broken.stderr,
      /migrations: cannot read the apps roots from \.dependency-cruiser\.cjs: /u,
    );

    const notLayout = run({
      ".dependency-cruiser.cjs": "module.exports = { forbidden: [], options: {} };\n",
    });
    assert.equal(notLayout.status, 1);
    assert.match(
      notLayout.stderr,
      /cannot read the apps roots from \.dependency-cruiser\.cjs: \.dependency-cruiser\.cjs has no "packages-do-not-import-apps" rule from layout\(\)/u,
    );

    const notConfig = run({ ".dependency-cruiser.cjs": "module.exports = 3;\n" });
    assert.equal(notConfig.status, 1);
    assert.match(notConfig.stderr, /must export a Dependency Cruiser layout config/u);
  });
});
