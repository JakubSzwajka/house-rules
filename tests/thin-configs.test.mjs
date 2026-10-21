import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { ESLint } from "eslint";
import { featuresConfig } from "@house-rules/rules";

const PLUGIN = "@house-rules/rules";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));
const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = {
  appsDir: ["apps", "examples/booking/apps"],
  packagesDir: ["packages", "examples/booking/packages"],
};

describe("thin configs over the house plugin", () => {
  it("tsconfig.base.json extends the Effect preset and does not replace its plugin block", () => {
    const tsconfig = readJson("tsconfig.base.json");
    assert.equal(tsconfig.extends, `${PLUGIN}/tsconfig/effect.json`);
    assert.equal(tsconfig.compilerOptions?.plugins, undefined);
  });

  it("check fails on Biome and ESLint warnings: biome and lint keep their warning flags", () => {
    const { scripts } = readJson("package.json");
    assert.match(scripts.biome, /\bbiome check\b.*--error-on-warnings\b/);
    assert.match(scripts.lint, /\beslint\b.*--max-warnings 0\b/);
    assert.match(
      scripts.lint,
      /--format \.\/node_modules\/@house-rules\/rules\/src\/eslint-formatter\.mjs/,
    );
    assert.match(scripts.check, /\bpnpm run biome\b.*\bpnpm run lint\b/);
  });

  it("biome.json extends the Biome preset", () => {
    assert.deepEqual(readJson("biome.json").extends, [`${PLUGIN}/biome`]);
  });

  it("biome.json keeps the .pi/specs exclusion", () => {
    assert.ok(readJson("biome.json").files.includes.includes("!!.pi/specs"));
  });

  it(".dependency-cruiser.cjs builds on layout() and keeps every layout rule unchanged", () => {
    assert.match(
      read(".dependency-cruiser.cjs"),
      new RegExp(`require\\("${PLUGIN}/dependency-cruiser"\\)`),
    );
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    const rules = layout({
      scope: "@example/",
      ...ROOTS,
      adapterPackages: ["migrations"],
    }).forbidden;
    for (const rule of rules) {
      if (rule.name === "no-unresolved-imports") continue;
      const expected = rules.filter(({ name }) => name === rule.name);
      const local = config.forbidden.filter(({ name }) => name === rule.name);
      assert.deepEqual(local, expected, `layout rule ${rule.name}`);
    }
  });

  it(".dependency-cruiser.cjs names @house-rules/migrations as an adapter package, and only it", () => {
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    const rule = config.forbidden.find(({ name }) => name === "adapter-imports-only-in-adapters");
    assert.equal(rule.severity, "error");
    assert.deepEqual(rule.from.pathNot, [
      "^(?:packages|examples/booking/packages)/[^/]+/src/adapters(?:/|$)",
      "^(?:packages|examples/booking/packages)/(?:migrations)/",
    ]);
    const folderRules = config.forbidden.filter(
      ({ name, from }) => name === rule.name && from.path.includes("read-models"),
    );
    const expectedFolderRules = layout({
      scope: "@example/",
      ...ROOTS,
      adapterPackages: ["migrations"],
    }).forbidden.filter(
      ({ name, from }) => name === rule.name && from.path.includes("read-models"),
    );
    assert.deepEqual(folderRules, expectedFolderRules);
    assert.equal(folderRules.length, 1);
    const appsPattern =
      ROOTS.appsDir.length === 1 ? ROOTS.appsDir[0] : `(?:${ROOTS.appsDir.join("|")})`;
    for (const folderRule of folderRules) {
      assert.equal(folderRule.severity, "error");
      assert.equal(
        folderRule.from.pathNot,
        `^${appsPattern}/[^/]+/src/read-models/[^/]+/adapters/`,
      );
      assert.deepEqual(folderRule.to, rule.to);
    }
  });

  it(".dependency-cruiser.cjs excludes only the in-repo plugin on top of the preset's excludes", () => {
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    const preset = layout({ scope: "@example/", ...ROOTS }).options.exclude.path;
    assert.equal(config.options.exclude.path, `${preset}|^packages/rules/`);
  });

  it(".dependency-cruiser.cjs allows astro: imports from site/ and still flags them elsewhere", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "house-rules-astro-"));
    try {
      for (const file of ["site/page.ts", "scripts/page.ts"]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await writeFile(
          join(workspace, file),
          'import { getCollection } from "astro:content";\nexport const all = getCollection;\n',
        );
      }
      const config = require("../.dependency-cruiser.cjs");
      const { output } = await cruise(["site", "scripts"], {
        ...structuredClone(config.options),
        baseDir: workspace,
        ruleSet: { forbidden: structuredClone(config.forbidden) },
        validate: true,
        outputType: "json",
      });
      const violations = JSON.parse(output).summary.violations.map(
        ({ from, rule }) => `${from}: ${rule.name}`,
      );
      assert.deepEqual(violations, ["scripts/page.ts: no-unresolved-imports"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it(".dependency-cruiser.cjs keeps framework packages from importing anything under examples/", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "house-rules-examples-"));
    const files = {
      "packages/catalog/src/catalog/leak.ts":
        'import { order } from "../../../../examples/shop/packages/orders/src/index.ts";\nexport const leak = order;\n',
      "packages/catalog/src/catalog/item.ts":
        'import { kit } from "../../../kit/src/index.ts";\nexport const item = kit;\n',
      "packages/kit/src/index.ts": "export const kit = 1;\n",
      "examples/shop/packages/orders/src/index.ts":
        'import { kit } from "../../../../../packages/kit/src/index.ts";\nexport const order = kit;\n',
    };
    try {
      for (const [file, contents] of Object.entries(files)) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await writeFile(join(workspace, file), contents);
      }
      const config = require("../.dependency-cruiser.cjs");
      const { output } = await cruise(["packages", "examples"], {
        ...structuredClone(config.options),
        baseDir: workspace,
        ruleSet: { forbidden: structuredClone(config.forbidden) },
        validate: true,
        outputType: "json",
      });
      const violations = JSON.parse(output)
        .summary.violations.filter(({ rule }) => rule.name === "framework-does-not-import-examples")
        .map(({ from, to, rule }) => `${from} -> ${to}: ${rule.severity}`);
      assert.deepEqual(violations, [
        "packages/catalog/src/catalog/leak.ts -> examples/shop/packages/orders/src/index.ts: error",
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("the root uses the in-repo plugin as a workspace package", () => {
    assert.equal(
      readJson("package.json").devDependencies[PLUGIN],
      `workspace:${readJson("packages/rules/package.json").version}`,
    );
    assert.equal(readJson("packages/rules/package.json").name, PLUGIN);
  });

  it("the pins script runs the plugin's bin", () => {
    assert.equal(readJson("package.json").scripts.pins, "house-rules-pins");
  });

  it("the layout script runs the plugin's bin after Dependency Cruiser", () => {
    const { scripts } = readJson("package.json");
    assert.equal(scripts.layout, "house-rules-layout");
    assert.equal(
      readJson("packages/rules/package.json").bin["house-rules-layout"],
      "bin/layout.mjs",
    );
    assert.match(scripts.check, /pnpm run migrations &&/);
    assert.match(scripts.check, /pnpm run deps && pnpm run layout$/);
  });

  it("eslint.config.mjs derives the features preset and guards both configured apps and tests", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const rulesFor = async (code, filePath) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result.messages.map(({ ruleId }) => ruleId);
    };

    const preset = featuresConfig(ROOTS);
    for (const app of ["apps/api", "apps/web", "examples/booking/apps/api"]) {
      const file = `${app}/src/features/wiring-probe/index.ts`;
      const config = await eslint.calculateConfigForFile(file);
      for (const block of preset) {
        for (const name of ["feature-file", "feature-builders", "esm-only-effect"]) {
          const id = `house-rules/${name}`;
          if (block.rules?.[id] !== undefined) {
            const [severity, options] = block.rules[id];
            assert.equal(severity, "error");
            assert.deepEqual(config.rules[id], [2, options]);
          }
        }
      }
      for (const part of ["index", "extra"]) {
        assert.deepEqual(
          await rulesFor("export const x = 1;\n", `${app}/src/features/wiring-probe/${part}.ts`),
          ["house-rules/feature-file"],
        );
      }
      assert.deepEqual(
        await rulesFor(
          'import { defineFeature } from "@house-rules/application/contract";\nexport const feature = defineFeature("misplaced", {});\n',
          `${app}/src/ways-in/web/endpoints.ts`,
        ),
        ["house-rules/feature-builders"],
      );
      for (const part of [
        "features/wiring-probe/index.ts",
        "ways-in/web/endpoints.ts",
        "read-models/probe/contract.ts",
      ]) {
        assert.deepEqual(
          await rulesFor(
            "export const load = (name: string) => import(name);\n",
            `${app}/src/${part}`,
          ),
          [
            ...(part === "features/wiring-probe/index.ts"
              ? ["house-rules/feature-file", "house-rules/feature-file"]
              : []),
            "house-rules/no-computed-import",
          ],
        );
      }
    }
    assert.deepEqual(
      await rulesFor(
        "export const load = (name: string) => import(name);\n",
        "packages/bookings/src/booking/wiring-probe.ts",
      ),
      ["house-rules/no-computed-import"],
    );
    for (const source of ["effect/ai", "effect/unstable/ai"]) {
      assert.deepEqual(
        await rulesFor(
          `import { Tool } from "${source}";\nexport const T = Tool.make("probe");\n`,
          "apps/api/src/ways-in/mcp/wiring-probe.ts",
        ),
        ["house-rules/no-hand-rolled-surface"],
      );
    }
    assert.deepEqual(
      await rulesFor(
        'import { Effect } from "effect";\nexport const run = () => Effect.runPromise(Effect.void);\n',
        "apps/api/src/features/wiring-probe/tests/wiring-probe.test.ts",
      ),
      ["house-rules/no-hand-run-effect"],
    );
    assert.deepEqual(
      await rulesFor(
        'import { MigrationsTesting } from "@house-rules/migrations";\nexport const db = MigrationsTesting;\n',
        "apps/api/src/composition/wiring-probe.ts",
      ),
      ["house-rules/testing-exports-only-in-tests"],
    );
  });
});
