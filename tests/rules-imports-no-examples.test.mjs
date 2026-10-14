import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const RULE = "framework-does-not-import-examples";
const SOURCES = ["packages/rules/src", "packages/rules/bin"];
const RULES_EXCLUSION = "|^packages/rules/";

async function examplesImports(baseDir) {
  const config = require("../.dependency-cruiser.cjs");
  const rule = config.forbidden.find(({ name }) => name === RULE);
  assert.ok(rule, `.dependency-cruiser.cjs defines ${RULE}`);
  assert.ok(config.options.exclude.path.endsWith(RULES_EXCLUSION));
  const options = structuredClone(config.options);
  // Lift the plugin's exemption for this one ban only; no other layout rule runs here.
  options.exclude.path = options.exclude.path.slice(0, -RULES_EXCLUSION.length);
  const { output } = await cruise(SOURCES, {
    ...options,
    baseDir,
    ruleSet: {
      forbidden: [
        {
          ...structuredClone(rule),
          from: { path: "^packages/rules/(?:src|bin)/" },
          to: { path: `${rule.to.path}|^@example/` },
        },
      ],
    },
    validate: true,
    outputType: "json",
  });
  const result = JSON.parse(output);
  return {
    modules: result.modules.map(({ source }) => source),
    violations: result.summary.violations.map(
      ({ from, to, rule: { name, severity } }) => `${from} -> ${to}: ${name} ${severity}`,
    ),
  };
}

function sourceFiles(root) {
  return SOURCES.flatMap((folder) =>
    readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /[.](?:mjs|cjs|js)$/u.test(entry.name))
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/")),
  );
}

describe("@house-rules/rules never imports the examples", () => {
  it("no production source in packages/rules imports anything under examples/ or an @example/ package", async () => {
    const { modules, violations } = await examplesImports(repositoryRoot);
    for (const file of sourceFiles(repositoryRoot)) {
      assert.ok(modules.includes(file), `the cruise reads ${file}`);
    }
    assert.deepEqual(violations, []);
  });

  it("catches a planted static import, require() and import() into the examples in a copy", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "house-rules-rules-examples-"));
    try {
      for (const folder of SOURCES) {
        await cp(join(repositoryRoot, folder), join(workspace, folder), { recursive: true });
      }
      const planted = {
        "packages/rules/src/review-leak.mjs":
          'import { main } from "../../../examples/shop/apps/api/src/main.ts";\nexport const leak = main;\n',
        "packages/rules/src/lazy-leak.mjs":
          'export const lazy = () => import("../../../examples/shop/packages/orders/src/index.ts");\n',
        "packages/rules/bin/name-leak.cjs": 'module.exports = require("@example/orders");\n',
        "examples/shop/apps/api/src/main.ts": "export const main = 1;\n",
        "examples/shop/packages/orders/src/index.ts": "export const order = 1;\n",
      };
      for (const [file, contents] of Object.entries(planted)) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await writeFile(join(workspace, file), contents);
      }
      const { violations } = await examplesImports(workspace);
      assert.deepEqual(violations.toSorted(), [
        `packages/rules/bin/name-leak.cjs -> @example/orders: ${RULE} error`,
        `packages/rules/src/lazy-leak.mjs -> examples/shop/packages/orders/src/index.ts: ${RULE} error`,
        `packages/rules/src/review-leak.mjs -> examples/shop/apps/api/src/main.ts: ${RULE} error`,
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
