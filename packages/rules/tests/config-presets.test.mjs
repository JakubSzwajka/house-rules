import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { withConsumer } from "./preset-consumer.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(import.meta.dirname, "fixtures/presets");
const bin = (name) => path.join(repositoryRoot, "node_modules/.bin", name);
// TypeScript 7 is installed under an alias so the ESLint parser keeps its TypeScript 6 peer.
const tsc7 = path.join(repositoryRoot, "node_modules/typescript-7/bin/tsc");
const readJson = async (file) =>
  JSON.parse(await readFile(path.join(repositoryRoot, file), "utf8"));

test("strict.json plus effect.json equal drunk-cat-stack's tsconfig.base.json", async () => {
  const strict = await readJson("tsconfig/strict.json");
  const effect = await readJson("tsconfig/effect.json");
  const original = await readJson("tests/fixtures/presets/drunk-cat-stack.tsconfig.base.json");
  assert.equal(effect.extends, "./strict.json");
  assert.equal(strict.compilerOptions.plugins, undefined);
  assert.deepEqual(Object.keys(effect.compilerOptions), ["plugins"]);
  assert.deepEqual(
    { ...strict.compilerOptions, ...effect.compilerOptions },
    original.compilerOptions,
  );
});

test("the Biome preset equals drunk-cat-stack's biome.json without the consumer-owned files block, plus Tailwind parsing", async () => {
  const { css, ...preset } = await readJson("biome/preset.json");
  assert.deepEqual(css, { parser: { tailwindDirectives: true } });
  const { files, ...original } = JSON.parse(
    await readFile(path.join(FIXTURES, "drunk-cat-stack.biome.json"), "utf8"),
  );
  assert.ok(files);
  assert.deepEqual(preset, original);
});

// tsc --showConfig omits `plugins`; the Effect diagnostics need @effect/tsgo and are proven in a consumer instead.
test("the preset tests run the TypeScript and Biome versions drunk-cat-stack pins", () => {
  assert.match(spawnSync(tsc7, ["--version"], { encoding: "utf8" }).stdout, /^Version 7\.0\.2\b/);
  assert.match(
    spawnSync(bin("biome"), ["--version"], { encoding: "utf8" }).stdout,
    /^Version: 2\.5\.14\b/,
  );
});

test("web.json extends strict.json with DOM libs and bundler resolution, and no plugin block", async () => {
  const web = await readJson("tsconfig/web.json");
  assert.equal(web.extends, "./strict.json");
  assert.deepEqual(web.compilerOptions, {
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "Bundler",
  });
  const manifest = await readJson("package.json");
  assert.equal(manifest.exports["./tsconfig/web.json"], "./tsconfig/web.json");
});

test("TypeScript resolves every tsconfig preset through package exports", async () => {
  for (const preset of ["strict", "effect", "web", "next"]) {
    const tsconfig = {
      extends: `@house-rules/rules/tsconfig/${preset}.json`,
      include: ["*.ts"],
    };
    await withConsumer(
      {
        "package.json": { type: "module" },
        "tsconfig.json": tsconfig,
        "clean.ts":
          "export const first = (values: readonly number[]): number | undefined => values[0];\n",
      },
      async (run) => {
        const shown = run(tsc7, ["--showConfig"]);
        assert.equal(shown.status, 0, shown.output);
        const { compilerOptions } = JSON.parse(shown.output);
        assert.equal(compilerOptions.strict, true);
        assert.equal(compilerOptions.noUncheckedIndexedAccess, true);
        assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
        assert.equal(compilerOptions.noEmit, true);
        const clean = run(tsc7, ["--project", "tsconfig.json"]);
        assert.equal(clean.status, 0, clean.output);
      },
    );
  }
});

test("a consumer on the strict preset fails on an unchecked index access", async () => {
  await withConsumer(
    {
      "package.json": { type: "module" },
      "tsconfig.json": {
        extends: "@house-rules/rules/tsconfig/strict.json",
        include: ["*.ts"],
      },
      "unchecked.ts": "export const first = (values: readonly number[]): number => values[0];\n",
    },
    async (run) => {
      const result = run(tsc7, ["--project", "tsconfig.json"]);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /unchecked\.ts\(1,\d+\): error TS2322/);
    },
  );
});

// A bundler-style UI file: DOM globals and an extensionless relative import.
const WEB_FILES = {
  "package.json": { type: "module" },
  "src/label.ts": 'export const label = "Ready";\n',
  "src/page.ts":
    'import { label } from "./label";\nexport const heading = (): string => `${document.title} ${label}`;\n',
};

test("a UI file that needs DOM and bundler resolution passes on web.json and fails on strict.json", async () => {
  for (const [preset, passes] of [
    ["web", true],
    ["strict", false],
  ]) {
    await withConsumer(
      {
        ...WEB_FILES,
        "tsconfig.json": {
          extends: `@house-rules/rules/tsconfig/${preset}.json`,
          include: ["src"],
        },
      },
      async (run) => {
        const result = run(tsc7, ["--project", "tsconfig.json"]);
        if (passes) {
          assert.equal(result.status, 0, result.output);
        } else {
          assert.match(result.output, /page\.ts\(1,\d+\): error TS2835/);
          assert.match(result.output, /page\.ts\(2,\d+\): error TS2584/);
        }
      },
    );
  }
});

// Next 16 rewrites a tsconfig only when it has no `extends`, so these options live in the preset.
test("next.json extends web.json with the options and plugin Next.js needs", async () => {
  const next = await readJson("tsconfig/next.json");
  assert.equal(next.extends, "./web.json");
  assert.deepEqual(next.compilerOptions, {
    jsx: "react-jsx",
    allowJs: false,
    esModuleInterop: true,
    resolveJsonModule: true,
    plugins: [{ name: "next" }],
  });
  const manifest = await readJson("package.json");
  assert.equal(manifest.exports["./tsconfig/next.json"], "./tsconfig/next.json");
  const nextFiles = {
    ...WEB_FILES,
    "src/data.json": '{ "title": "Ready" }\n',
    "src/legacy.js": "export const legacy = 1;\n",
    "src/view.ts": 'import data from "./data.json";\nexport const view = data.title;\n',
    "src/untyped.ts": 'import { legacy } from "./legacy.js";\nexport const untyped = legacy;\n',
    "tsconfig.json": { extends: "@house-rules/rules/tsconfig/next.json", include: ["src"] },
  };
  await withConsumer(nextFiles, async (run) => {
    const shown = run(tsc7, ["--showConfig"]);
    assert.equal(shown.status, 0, shown.output);
    const { compilerOptions } = JSON.parse(shown.output);
    assert.deepEqual(compilerOptions.lib, ["es2023", "dom", "dom.iterable"]);
    assert.equal(compilerOptions.moduleResolution, "bundler");
    assert.equal(compilerOptions.allowJs, false);
    assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
    // A JSON import compiles; a .js file stays out, so its import is an untyped-module error.
    const result = run(tsc7, ["--project", "tsconfig.json"]);
    assert.doesNotMatch(result.output, /view\.ts/);
    assert.match(result.output, /untyped\.ts\(1,\d+\): error TS7016/);
  });
});

test("web.json keeps every strict flag", async () => {
  await withConsumer(
    {
      ...WEB_FILES,
      "tsconfig.json": { extends: "@house-rules/rules/tsconfig/web.json", include: ["src"] },
      "src/unchecked.ts":
        "export const first = (values: readonly number[]): number => values[0];\n",
    },
    async (run) => {
      const result = run(tsc7, ["--project", "tsconfig.json"]);
      assert.match(result.output, /unchecked\.ts\(1,\d+\): error TS2322/);
    },
  );
});

// The app's Effect tsconfig lists effect.json first, so web.json's options win and the plugin block stays.
// The other order puts strict.json's NodeNext and ES2023-only lib back.
test("extends [effect.json, web.json] gives the Effect code DOM libs and bundler resolution", async () => {
  const extendsOrder = (first, second) => ({
    extends: [
      `@house-rules/rules/tsconfig/${first}.json`,
      `@house-rules/rules/tsconfig/${second}.json`,
    ],
    include: ["src"],
  });
  await withConsumer(
    { ...WEB_FILES, "tsconfig.json": extendsOrder("effect", "web") },
    async (run) => {
      const shown = run(tsc7, ["--showConfig"]);
      assert.equal(shown.status, 0, shown.output);
      const { compilerOptions } = JSON.parse(shown.output);
      assert.deepEqual(compilerOptions.lib, ["es2023", "dom", "dom.iterable"]);
      assert.equal(compilerOptions.moduleResolution, "bundler");
      assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
      const result = run(tsc7, ["--project", "tsconfig.json"]);
      assert.equal(result.status, 0, result.output);
    },
  );
  await withConsumer(
    { ...WEB_FILES, "tsconfig.json": extendsOrder("web", "effect") },
    async (run) => {
      const result = run(tsc7, ["--project", "tsconfig.json"]);
      assert.match(result.output, /page\.ts\(1,\d+\): error TS2835/);
    },
  );
});

const CSS_FIXTURES = ["plain.css", "plain-unformatted.css", "tailwind.css"];
const cssFixtures = async () =>
  Object.fromEntries(
    await Promise.all(
      CSS_FIXTURES.map(async (name) => [
        `src/${name}`,
        await readFile(path.join(FIXTURES, "css", name), "utf8"),
      ]),
    ),
  );
// Drops the timing line, so two runs over the same file compare equal.
const withoutTiming = (output) => output.replace(/^Checked \d+ files? in .*$/mu, "");

async function biomeCheckCss(biomeConfig) {
  const results = {};
  await withConsumer({ "biome.json": biomeConfig, ...(await cssFixtures()) }, async (run) => {
    for (const name of CSS_FIXTURES) {
      const { status, output } = run(bin("biome"), ["check", `src/${name}`]);
      results[name] = { status, output: withoutTiming(output) };
    }
  });
  return results;
}

test("the Biome preset parses Tailwind v4 directives and checks plain CSS exactly as without them", async () => {
  const preset = await biomeCheckCss({ extends: ["@house-rules/rules/biome"] });
  const plain = await biomeCheckCss({
    extends: ["@house-rules/rules/biome"],
    css: { parser: { tailwindDirectives: false } },
  });

  assert.equal(preset["tailwind.css"].status, 0, preset["tailwind.css"].output);
  assert.equal(plain["tailwind.css"].status, 1);
  assert.match(plain["tailwind.css"].output, /Tailwind-specific syntax is disabled/);

  assert.equal(preset["plain.css"].status, 0, preset["plain.css"].output);
  assert.equal(preset["plain-unformatted.css"].status, 1);
  assert.match(preset["plain-unformatted.css"].output, /Formatter would have printed/);
  for (const name of ["plain.css", "plain-unformatted.css"]) {
    assert.deepEqual(preset[name], plain[name], name);
  }
});

test("Biome extends the preset from the package and enforces its rules", async () => {
  await withConsumer(
    {
      "biome.json": { extends: ["@house-rules/rules/biome"] },
      "src/clean.ts": 'export { value } from "./value.js";\n',
      "src/value.ts": "export const value = 1;\n",
    },
    async (run) => {
      const clean = run(bin("biome"), ["check", "src"]);
      assert.equal(clean.status, 0, clean.output);
    },
  );
  await withConsumer(
    {
      "biome.json": { extends: ["@house-rules/rules/biome"] },
      "src/barrel.ts": 'export * from "./value.js";\n',
      "src/value.ts": "export const value: number | undefined = 1;\nexport const sure = value!;\n",
      "src/BadName.ts": "export const x = 1;\n",
    },
    async (run) => {
      const result = run(bin("biome"), ["lint", "src"]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /barrel\.ts:1:8 lint\/performance\/noReExportAll/);
      assert.match(result.output, /value\.ts:2:\d+ lint\/style\/noNonNullAssertion/);
      assert.match(result.output, /BadName\.ts lint\/style\/useFilenamingConvention/);
    },
  );
});
