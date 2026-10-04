import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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
    const rules = layout({ scope: "@hosti/", adapterPackages: ["migrations"] }).forbidden;
    for (const rule of rules) {
      const expected = rules.filter(({ name }) => name === rule.name);
      const local = config.forbidden.filter(({ name }) => name === rule.name);
      assert.deepEqual(local, expected, `layout rule ${rule.name}`);
    }
  });

  it(".dependency-cruiser.cjs names @house-rules/migrations as an adapter package, and only it", () => {
    const config = require("../.dependency-cruiser.cjs");
    const rule = config.forbidden.find(({ name }) => name === "adapter-imports-only-in-adapters");
    assert.equal(rule.severity, "error");
    assert.deepEqual(rule.from.pathNot, [
      "^packages/[^/]+/src/adapters(?:/|$)",
      "^packages/(?:migrations)/",
    ]);
  });

  it(".dependency-cruiser.cjs excludes only the in-repo plugin and Astro's virtual modules on top of the preset's excludes", () => {
    const { layout } = require(`${PLUGIN}/dependency-cruiser`);
    const config = require("../.dependency-cruiser.cjs");
    const preset = layout({ scope: "@hosti/" }).options.exclude.path;
    assert.equal(config.options.exclude.path, `${preset}|^packages/rules/|^astro:`);
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

  it("eslint.config.mjs turns on the capability rules for use-cases, delivery, and tests", async () => {
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
    assert.deepEqual(
      await rulesFor(
        'import { Effect } from "effect";\nexport const run = () => Effect.runPromise(Effect.void);\n',
        "apps/api/src/use-cases/tests/wiring-probe.test.ts",
      ),
      ["house-rules/no-hand-run-effect"],
    );
  });
});
