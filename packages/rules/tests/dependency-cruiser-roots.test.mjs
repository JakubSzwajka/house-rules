import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { layout } from "../src/dependency-cruiser.cjs";
import { capabilityConfig } from "../src/index.mjs";
import { cruiseFixture, fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const layoutBin = fileURLToPath(new URL("../bin/layout.mjs", import.meta.url));
// The shape a template with an examples/ folder passes: its own roots plus each example's.
const ROOTS = {
  appsDir: ["apps", "examples/*/apps"],
  packagesDir: ["packages", "examples/*/packages"],
};
const byName = (config) => Object.fromEntries(config.forbidden.map((rule) => [rule.name, rule]));

test("a one-entry list builds the same config as the plain path", () => {
  assert.deepEqual(
    layout({ scope: "@acme/", appsDir: ["apps"], packagesDir: ["packages"] }),
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(
    layout({ scope: "@acme/", appsDir: ["services"], packagesDir: ["libs"] }),
    layout({ scope: "@acme/", appsDir: "services", packagesDir: "libs" }),
  );
});

test("several roots become one alternation in every pattern that names them", () => {
  const rules = byName(layout({ scope: "@acme/", ...ROOTS }));
  const apps = "(?:apps|examples/[^/]+/apps)";
  const packages = "(?:packages|examples/[^/]+/packages)";
  assert.equal(rules["packages-do-not-import-apps"].from.path, `^${packages}/`);
  assert.equal(rules["packages-do-not-import-apps"].to.path, `^${apps}/`);
  assert.equal(rules["apps-do-not-import-other-apps"].from.path, `^(${apps}/[^/]+)/`);
  assert.equal(rules["packages-imported-by-name"].from.path, `^((?:${apps}|${packages})/[^/]+)/`);
  assert.equal(
    rules["delivery-does-not-import-server"].from.path,
    `^${apps}/[^/]+/src/delivery(?:/|$)`,
  );
  assert.equal(
    rules["use-cases-do-not-import-use-cases"].from.path,
    `^(${apps}/[^/]+/src/use-cases/[^/]+)`,
  );
  assert.equal(rules["package-root-files"].module.path, `^${packages}/[^/]+/src/[^/]+$`);
  assert.equal(
    rules["no-ownerless-files"].module.path[0],
    `^(?:${apps}|${packages})/(?:.*/)?(?:utils|helpers|misc)(?:[.][^/]*)?(?:/|$)`,
  );
  assert.equal(rules["domain-does-not-import-adapters"].from.path, `^(${packages}/[^/]+)/src/`);
  assert.equal(
    rules["contract-entry-is-browser-safe"].from.path,
    `^${packages}/[^/]+/src/contract[.]ts$`,
  );
  const declarations = byName(
    layout({ scope: "@acme/", ...ROOTS, generatedDeclarationFiles: ["env.d.ts"] }),
  );
  assert.equal(
    declarations["no-unresolved-imports"].from.pathNot,
    `^${apps}/[^/]+/(?:env[.]d[.]ts)$`,
  );
  assert.equal(
    byName(layout({ scope: "@acme/", appsDir: "examples/*/apps" }))["app-code-in-layers"].module
      .path,
    "^examples/[^/]+/apps/[^/]+/src/",
  );
});

test("appsDir and packagesDir reject empty lists, absolute paths, .., other globs and overlaps", () => {
  const rejects = (options, message) =>
    assert.throws(() => layout({ scope: "@acme/", ...options }), message);
  rejects(
    { appsDir: [] },
    /appsDir must be a non-empty relative path, such as "apps", or a non-empty array/u,
  );
  rejects({ packagesDir: 3 }, /packagesDir must be a non-empty relative path/u);
  rejects({ appsDir: ["apps", 3] }, /appsDir must be a non-empty relative path/u);
  rejects({ appsDir: "" }, /appsDir must be a non-empty relative path/u);
  rejects(
    { appsDir: "/apps" },
    /appsDir must be a non-empty relative path without a leading or trailing "\/"/u,
  );
  rejects(
    { packagesDir: ["packages", "examples/*/packages/"] },
    /packagesDir must be a non-empty relative path/u,
  );
  rejects({ appsDir: ["apps", "../apps"] }, /appsDir .*"\.\."\. Got "\.\.\/apps"/u);
  rejects({ appsDir: "examples/../apps" }, /"\.\."/u);
  rejects({ appsDir: "./apps" }, /"\."/u);
  rejects({ appsDir: "examples//apps" }, /an empty segment/u);
  rejects(
    { appsDir: ["apps", "examples/**/apps"] },
    /appsDir entry "examples\/\*\*\/apps" uses a glob other than a whole "\*" segment/u,
  );
  rejects(
    { packagesDir: "examples/shop-*/packages" },
    /uses a glob other than a whole "\*" segment/u,
  );
  rejects({ packagesDir: "examples/?/packages" }, /uses a glob other than a whole "\*" segment/u);
  rejects(
    { packagesDir: "examples/{a,b}/packages" },
    /uses a glob other than a whole "\*" segment/u,
  );
  rejects(
    { packagesDir: "examples/[ab]/packages" },
    /uses a glob other than a whole "\*" segment/u,
  );
  rejects(
    { packagesDir: ["packages", "examples/*/packages/*"] },
    /packagesDir entry "examples\/\*\/packages\/\*" ends in "\*"\. Name the folder that holds them, such as "examples\/\*\/packages"/u,
  );
  rejects({ appsDir: ["apps", "apps"] }, /appsDir entries "apps" and "apps" overlap/u);
  rejects(
    { appsDir: ["apps", "apps/web/apps"] },
    /appsDir entries "apps" and "apps\/web\/apps" overlap/u,
  );
  rejects(
    { appsDir: ["examples/*/apps", "examples/shop/apps"] },
    /appsDir entries "examples\/\*\/apps" and "examples\/shop\/apps" overlap/u,
  );
  rejects(
    { appsDir: ["apps", "examples"], packagesDir: ["packages", "examples/*/packages"] },
    /appsDir "examples" and packagesDir "examples\/\*\/packages" overlap/u,
  );
  rejects(
    { appsDir: ["apps", "examples/*/apps"], packagesDir: ["packages", "examples/shop"] },
    /appsDir "examples\/\*\/apps" and packagesDir "examples\/shop" overlap/u,
  );
  rejects({ appsDir: "src", packagesDir: "src" }, /appsDir "src" and packagesDir "src" overlap/u);
  assert.doesNotThrow(() => layout({ scope: "@acme/", ...ROOTS }));
});

test("the layout rules hold in every root of a two-root workspace", async () => {
  const violations = await violatedRules("two-roots", layout({ scope: "@acme/", ...ROOTS }));
  assert.deepEqual(fromPaths(violations), [
    "app-code-in-layers: examples/shop/apps/api/src/stray.ts",
    "apps-do-not-import-other-apps: apps/web/src/main.ts -> examples/shop/apps/api/src/main.ts",
    "delivery-does-not-import-server: examples/shop/apps/api/src/delivery/routes.ts -> examples/shop/apps/api/src/server/loop.ts",
    "no-ownerless-files: examples/shop/apps/api/src/delivery/helpers.ts",
    "no-ownerless-files: examples/shop/packages/orders/src/types.ts",
    "package-root-files: examples/shop/packages/orders/src/types.ts",
    "packages-do-not-import-apps: examples/shop/packages/orders/src/order/leak.ts -> examples/shop/apps/api/src/main.ts",
    "packages-do-not-import-apps: packages/catalog/src/catalog/leak.ts -> examples/shop/apps/api/src/main.ts",
    "packages-imported-by-name: packages/catalog/src/catalog/deep.ts -> examples/shop/packages/orders/src/order/order.ts",
    "packages-public-entry-only: packages/catalog/src/catalog/deep.ts -> examples/shop/packages/orders/src/order/order.ts",
    "use-cases-do-not-import-composition: examples/shop/apps/api/src/use-cases/show-order.ts -> examples/shop/apps/api/src/composition/index.ts",
  ]);
});

test("with the default roots, the same workspace checks only apps/ and packages/", async () => {
  const violations = await violatedRules("two-roots", layout({ scope: "@acme/" }));
  assert.deepEqual(
    violations.filter(({ from }) => from.startsWith("examples/")),
    [],
  );
});

test("house-rules-layout finds package and subject-folder cycles and manifests in every root", async () => {
  const config = layout({ scope: "@acme/", ...ROOTS });
  const { status, stderr } = await cruiseFixture("two-roots-cycles", config, ({ workspace }) => {
    writeFileSync(
      path.join(workspace, ".dependency-cruiser.cjs"),
      `module.exports = ${JSON.stringify(config)};\n`,
    );
    return spawnSync(process.execPath, [layoutBin, "--cwd", workspace], { encoding: "utf8" });
  });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /no-package-cycles: 1 cycle\(s\) between workspace packages/u);
  assert.match(stderr, /@acme\/catalog -> @acme\/orders -> @acme\/catalog/u);
  assert.match(
    stderr,
    /@acme\/orders -> @acme\/catalog: examples\/shop\/packages\/orders\/src\/order\/link\.ts -> packages\/catalog\/src\/index\.ts/u,
  );
  assert.match(stderr, /no-subject-folder-cycles: 1 cycle\(s\) in package subject folders/u);
  assert.match(
    stderr,
    /examples\/shop\/packages\/orders\/src\/line -> examples\/shop\/packages\/orders\/src\/order -> examples\/shop\/packages\/orders\/src\/line/u,
  );
  assert.match(
    stderr,
    /examples\/shop\/packages\/orders\/package\.json: "\.\/browser\/\*" is exported; only "\." and "\.\/contract" may be/u,
  );
});

test("capabilityConfig() takes the same root lists as layout()", () => {
  const config = capabilityConfig(ROOTS);
  const rulesAt = (code, filename) =>
    new Linter()
      .verify(code, config, { filename })
      .map(({ ruleId }) => ruleId)
      .filter((ruleId, index, all) => ruleId && all.indexOf(ruleId) === index);
  const computed = "const at = './x.ts';\nawait import(at);";
  assert.deepEqual(rulesAt(computed, "examples/shop/packages/orders/src/order/load.ts"), [
    "house-rules/no-computed-import",
  ]);
  assert.deepEqual(rulesAt(computed, "packages/catalog/src/catalog/load.ts"), [
    "house-rules/no-computed-import",
  ]);
  assert.deepEqual(rulesAt(computed, "examples/shop/apps/api/src/delivery/load.ts"), []);
  const loose = "export const helper = 1;";
  assert.deepEqual(rulesAt(loose, "examples/shop/apps/api/src/use-cases/show-order.ts"), [
    "house-rules/use-case-is-capability",
  ]);
  assert.deepEqual(rulesAt(loose, "apps/web/src/use-cases/show-order.ts"), [
    "house-rules/use-case-is-capability",
  ]);
  assert.deepEqual(rulesAt(loose, "examples/shop/apps/api/src/use-cases/tests/show.test.ts"), []);
  assert.throws(() => capabilityConfig({ packagesDir: [] }), /capabilityConfig\(\): packagesDir/u);
  assert.throws(
    () => capabilityConfig({ appsDir: "examples/**/apps" }),
    /capabilityConfig\(\): appsDir entry/u,
  );
  assert.throws(
    () => capabilityConfig({ appsDir: "src", packagesDir: "src" }),
    /capabilityConfig\(\): appsDir "src" and packagesDir "src" overlap/u,
  );
});
