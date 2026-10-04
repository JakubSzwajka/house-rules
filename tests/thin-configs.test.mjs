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

const PLUGIN = "@house-rules/rules";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));
const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

describe("thin configs over the house plugin", () => {
  it("tsconfig.base.json extends the Effect preset and does not replace its plugin block", () => {
    const tsconfig = readJson("tsconfig.base.json");
    assert.equal(tsconfig.extends, `${PLUGIN}/tsconfig/effect.json`);
    assert.equal(tsconfig.compilerOptions?.plugins, undefined);
  });

  it("biome.json extends the Biome preset", () => {
    assert.deepEqual(readJson("biome.json").extends, [`${PLUGIN}/biome`]);
  });

  it(".dependency-cruiser.cjs builds on layout() and keeps every layout rule unchanged", () => {
    assert.match(
      read(".dependency-cruiser.cjs"),
      new RegExp(`require\\("${PLUGIN}/dependency-cruiser"\\)`),
    );
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    for (const rule of layout({ scope: "@hosti/" }).forbidden) {
      if (rule.name === "no-unresolved-imports") continue;
      const local = config.forbidden.find(({ name }) => name === rule.name);
      assert.deepEqual(local, rule, `layout rule ${rule.name}`);
    }
  });

  it(".dependency-cruiser.cjs excludes only the in-repo plugin on top of the preset's excludes", () => {
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    const preset = layout({ scope: "@hosti/" }).options.exclude.path;
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

  it("the migrations script runs the plugin's bin, and check runs it", () => {
    const { scripts } = readJson("package.json");
    assert.equal(scripts.migrations, "house-rules-migrations");
    assert.match(scripts.check, /pnpm run migrations &&/);
  });

  it("eslint.config.mjs turns on the capability rules for use-cases and delivery", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const rulesFor = async (code, filePath) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result.messages.map(({ ruleId }) => ruleId);
    };

    assert.deepEqual(
      await rulesFor("export const x = 1;\n", "apps/api/src/use-cases/wiring-probe.ts"),
      ["house-rules/use-case-is-capability", "house-rules/use-case-is-capability"],
    );
    assert.deepEqual(
      await rulesFor(
        'import { Tool } from "effect/unstable/ai";\nexport const T = Tool.make("probe");\n',
        "apps/api/src/delivery/mcp/wiring-probe.ts",
      ),
      ["house-rules/no-hand-rolled-surface"],
    );
  });
});
