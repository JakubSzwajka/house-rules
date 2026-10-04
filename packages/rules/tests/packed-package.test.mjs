import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function writeFixtureFiles(fixtureDirectory) {
  const { version: packageVersion, devDependencies } = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  await writeFile(
    path.join(fixtureDirectory, "package.json"),
    JSON.stringify(
      {
        name: "packed-plugin-fixture",
        private: true,
        type: "module",
        dependencies: {
          "@eslint/css": devDependencies["@eslint/css"],
          "@eslint/markdown": devDependencies["@eslint/markdown"],
          eslint: devDependencies.eslint,
        },
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    path.join(fixtureDirectory, "eslint.config.mjs"),
    'import houseRules from "@house-rules/rules";\nimport design from "@house-rules/rules/design";\nimport houseRulesMarkdown from "@house-rules/rules/markdown";\n\nexport default [\n  ...houseRules.configs.recommended,\n  ...houseRulesMarkdown,\n  ...design({\n    tokenFiles: ["styles/tokens.css"],\n    source: { files: ["**/*.tsx"] },\n    rules: { "design-scale-value": [{ property: "radius$", allowed: ["4px"] }] },\n  }),\n];\n',
  );
  await writeFile(
    path.join(fixtureDirectory, ".dependency-cruiser.cjs"),
    'module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@acme/" });\n',
  );
  await writeFile(
    path.join(fixtureDirectory, "pinned.json"),
    '{ "devDependencies": { "a": "1.2.3" } }\n',
  );
  await writeFile(
    path.join(fixtureDirectory, "pass.js"),
    "function run() {\n  // The retry must stay bounded by the caller's deadline.\n  return true;\n}\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "pass.ts"),
    "function run(value: string): string {\n  // The parser keeps this boundary typed.\n  return value;\n}\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "fail.js"),
    "// This top-level comment is narrative.\nconst value = 1;\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "fail.ts"),
    "// This top-level comment is narrative.\nconst value: string = 'value';\n",
  );
  await mkdir(path.join(fixtureDirectory, "docs"));
  await writeFile(
    path.join(fixtureDirectory, "pass.md"),
    "# Pass\n\nRead the [guide](docs/guide.md).\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "docs", "guide.md"),
    "# Guide\n\nBack to [pass](../pass.md).\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "fail.md"),
    "# Fail\n\nSee [missing](./missing.md) and [case](./PASS.md).\n",
  );
  await mkdir(path.join(fixtureDirectory, "styles"));
  await writeFile(
    path.join(fixtureDirectory, "styles", "tokens.css"),
    ":root {\n  --ink: #2b3133;\n  --paper: #ecf2f3;\n}\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "styles", "pass.css"),
    "a {\n  color: var(--ink);\n  border-radius: 4px;\n}\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "styles", "fail.css"),
    "a {\n  --local: #fff;\n  color: #2c3234;\n  background: var(--missing);\n  border-radius: 5px;\n}\n",
  );
  await writeFile(
    path.join(fixtureDirectory, "pass.tsx"),
    'export const A = () => <a href="#fade">&#8599;</a>;\n',
  );
  await writeFile(
    path.join(fixtureDirectory, "fail.tsx"),
    'export const A = () => <div style={{ color: "#2b3133" }} />;\n',
  );

  await writeFile(
    path.join(fixtureDirectory, "verify-install.mjs"),
    `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ESLint } from "eslint";
import houseRules from "@house-rules/rules";
import { layout } from "@house-rules/rules/dependency-cruiser";

assert.equal(houseRules.meta.name, "@house-rules/rules");
assert.equal(houseRules.configs.recommended[0].rules["house-rules/comment-discipline"], "error");
assert.match(import.meta.resolve("@house-rules/rules"), /node_modules/);
assert.match(import.meta.resolve("@house-rules/rules/markdown"), /node_modules/);
assert.match(import.meta.resolve("@house-rules/rules/design"), /node_modules/);
assert.match(import.meta.resolve("@house-rules/rules/dependency-cruiser"), /node_modules/);
assert.equal(houseRules.meta.version, ${JSON.stringify(packageVersion)});
for (const preset of ["tsconfig/strict.json", "tsconfig/effect.json", "biome"]) {
  const file = new URL(import.meta.resolve(\`@house-rules/rules/\${preset}\`));
  assert.match(file.pathname, /node_modules\\/@house-rules\\/rules\\//);
  assert.equal(typeof JSON.parse(readFileSync(file, "utf8")), "object");
}
const pins = spawnSync("node_modules/.bin/house-rules-pins", ["pinned.json"], { encoding: "utf8" });
assert.equal(pins.status, 0, pins.stderr);
assert.match(pins.stdout, /pins: every dependency is exact in pinned[.]json/);
const migrations = spawnSync("node_modules/.bin/house-rules-migrations", [], { encoding: "utf8" });
assert.equal(migrations.status, 0, migrations.stderr);
assert.match(migrations.stdout, /migrations: no SQL migrations found/);
assert.equal(houseRules.configs.capability[0].rules["house-rules/no-hand-rolled-surface"], "error");
assert.equal(houseRules.configs.capability[1].rules["house-rules/use-case-is-capability"], "error");

const dependencyCruiserConfig = createRequire(import.meta.url)("./.dependency-cruiser.cjs");
assert.deepEqual(dependencyCruiserConfig, layout({ scope: "@acme/" }));
assert.equal(dependencyCruiserConfig.forbidden.length, 16);
assert.equal(dependencyCruiserConfig.options.parser, "swc");

const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: "eslint.config.mjs" });
const passing = await eslint.lintFiles(["pass.js", "pass.ts"]);
assert.deepEqual(
  passing.map(({ errorCount, warningCount }) => ({ errorCount, warningCount })),
  [
    { errorCount: 0, warningCount: 0 },
    { errorCount: 0, warningCount: 0 },
  ],
);

const failing = await eslint.lintFiles(["fail.js", "fail.ts"]);
assert.deepEqual(
  failing.map(({ errorCount, warningCount, messages }) => ({
    errorCount,
    warningCount,
    ruleIds: messages.map(({ ruleId }) => ruleId),
  })),
  [
    { errorCount: 1, warningCount: 0, ruleIds: ["house-rules/comment-discipline"] },
    { errorCount: 1, warningCount: 0, ruleIds: ["house-rules/comment-discipline"] },
  ],
);

const markdownPassing = await eslint.lintFiles(["pass.md", "docs/guide.md"]);
assert.deepEqual(
  markdownPassing.map(({ errorCount, warningCount }) => ({ errorCount, warningCount })),
  [
    { errorCount: 0, warningCount: 0 },
    { errorCount: 0, warningCount: 0 },
  ],
);

const [markdownFailing] = await eslint.lintFiles(["fail.md"]);
assert.deepEqual(
  markdownFailing.messages.map(({ ruleId, line, column }) => ({ ruleId, line, column })),
  [
    { ruleId: "house-rules/no-broken-relative-links", line: 3, column: 5 },
    { ruleId: "house-rules/no-broken-relative-links", line: 3, column: 33 },
  ],
);

const designPassing = await eslint.lintFiles(["styles/tokens.css", "styles/pass.css", "pass.tsx"]);
assert.deepEqual(
  designPassing.map(({ messages }) => messages.map(({ message }) => message)),
  [[], [], []],
);

const [designFailing, sourceFailing] = await eslint.lintFiles(["styles/fail.css", "fail.tsx"]);
assert.deepEqual(
  designFailing.messages.map(({ ruleId, line, message }) => ({ ruleId, line, message })),
  [
    { ruleId: "house-rules/design-no-raw-color", line: 2, message: 'Raw colour "#fff". Use a design token; the nearest is var(--paper).' },
    { ruleId: "house-rules/design-no-raw-color", line: 3, message: 'Raw colour "#2c3234". Use a design token; the nearest is var(--ink).' },
    { ruleId: "house-rules/design-no-unknown-token", line: 4, message: "var(--missing) has no definition in the token files or in this file." },
    { ruleId: "house-rules/design-scale-value", line: 5, message: 'border-radius "5px" has values off the scale: 5px. Allowed: 4px.' },
  ],
);
assert.deepEqual(
  sourceFailing.messages.map(({ ruleId, line }) => ({ ruleId, line })),
  [{ ruleId: "house-rules/design-no-raw-color-literal", line: 1 }],
);
`,
  );
}

test("packs and installs the exact package before linting fresh JS, TS, Markdown, and design fixtures, loading the dependency-cruiser preset, resolving the config presets, and running the pins and migrations bins", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "house-rules-pack-"));
  const packageDirectory = path.join(temporaryDirectory, "package");
  const fixtureDirectory = path.join(temporaryDirectory, "fixture");
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(fixtureDirectory, { recursive: true }),
  ]);

  try {
    execFileSync("npm", ["pack", "--pack-destination", packageDirectory], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });
    const [packageArchive] = (await readdir(packageDirectory)).filter((entry) =>
      entry.endsWith(".tgz"),
    );
    assert.ok(packageArchive, "npm pack did not produce a tarball");

    await writeFixtureFiles(fixtureDirectory);
    const packageJsonPath = path.join(fixtureDirectory, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.dependencies["@house-rules/rules"] =
      `file:${path.join(packageDirectory, packageArchive)}`;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

    // ESLint is installed at the exact version this package pins in devDependencies.
    execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: fixtureDirectory,
      stdio: "pipe",
    });
    // The Markdown rule counts only git-tracked targets, so the fixture must be a repository.
    execFileSync("git", ["init", "--quiet"], { cwd: fixtureDirectory, stdio: "pipe" });
    execFileSync("git", ["add", "--", "pass.md", "docs/guide.md", "fail.md"], {
      cwd: fixtureDirectory,
      stdio: "pipe",
    });
    execFileSync(process.execPath, ["verify-install.mjs"], {
      cwd: fixtureDirectory,
      stdio: "pipe",
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
