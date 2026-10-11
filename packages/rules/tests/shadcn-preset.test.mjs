import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { plugin as shadcnPlugin } from "@shadcn/lint";
import tsParser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import design from "../src/design.mjs";
import housePlugin from "../src/index.mjs";
import shadcn, { shadcn as namedShadcn } from "../src/shadcn.mjs";

const APP = path.resolve(import.meta.dirname, "fixtures/shadcn-app");
const pluginWarnings = [];
mock.method(console, "warn", (message) => pluginWarnings.push(String(message)));

const RECOMMENDED_RULES = {
  "shadcn/no-restyle": ["error", { allow: ["layout"] }],
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
  "shadcn/no-inline-styles": "error",
  "shadcn/require-static-classes": "error",
  "shadcn/no-unknown-classes": "warn",
  "house-rules/design-no-raw-element": ["error", { components: ["**/components/ui/**"] }],
};

const HOME = "src/pages/home.tsx";
const HOME_FINDINGS = [
  `${HOME}:6:25 error shadcn/no-restyle "p-6" is not allowed on <Button>: <Button> owns its spacing. Use a size (default, sm), or margin here or gap on the parent for space around it. Add a size in src/components/ui/button.tsx only if the design explicitly calls for one.`,
  `${HOME}:7:26 error shadcn/require-static-classes Dynamically built className on <Button> cannot be checked. Use static class strings.`,
  `${HOME}:8:20 error shadcn/no-raw-colors "bg-pink-500" uses the raw Tailwind palette and no declared theme color is close to it. Use one of: background, foreground, primary, primary-foreground, or declare --color-<name> in src/app.css for a new color.`,
  `${HOME}:9:20 error shadcn/no-arbitrary-values "text-[13px]" hardcodes an off-token value. Nearest on the scale: text-xs (12px), text-sm (14px).`,
  `${HOME}:10:28 error shadcn/no-inline-styles Inline style sets padding. Style through classes; use CSS custom properties for dynamic values.`,
  `${HOME}:11:20 warn shadcn/no-unknown-classes "rounded-huge" is not a class this project's Tailwind knows, so no CSS is generated for it. Fix the spelling, or declare it with @utility in src/app.css.`,
];
const SALE_FINDING = `src/pages/brand.ts:3:21 error shadcn/no-raw-colors "bg-pink-500" uses the raw Tailwind palette and no declared theme color is close to it. Use one of: background, foreground, primary, primary-foreground, or declare --color-<name> in src/app.css for a new color.`;
const BUTTON_ARBITRARY = `src/components/ui/button.tsx:4:28 error shadcn/no-arbitrary-values "focus-visible:ring-[3px]" hardcodes an off-token value. Use a theme token or scale value instead.`;

async function lint(config, patterns = ["src"]) {
  const eslint = new ESLint({ cwd: APP, overrideConfigFile: true, overrideConfig: config });
  const results = await eslint.lintFiles(patterns);
  return results
    .flatMap(({ filePath, messages }) =>
      messages.map(
        ({ ruleId, severity, line, column, message }) =>
          `${path.relative(APP, filePath).split(path.sep).join("/")}:${line}:${column} ${severity === 2 ? "error" : "warn"} ${ruleId} ${message}`,
      ),
    )
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

async function packagesLoadedBy(entry) {
  const sourceDirectory = path.resolve(import.meta.dirname, "../src");
  const seen = new Set();
  const pending = [entry];
  const packages = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(path.join(sourceDirectory, file), "utf8");
    for (const [, specifier] of source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)) {
      if (specifier.startsWith("./")) pending.push(specifier.slice(2));
      else packages.add(specifier);
    }
  }
  return packages;
}

test("shadcn() returns an app block with the plugin's recommended rules and a component-folder block", () => {
  assert.equal(namedShadcn, shadcn);
  const [appBlock, componentBlock, ...rest] = shadcn();
  assert.equal(rest.length, 0);
  assert.deepEqual(appBlock.files, ["**/*.{jsx,tsx}"]);
  assert.equal(appBlock.languageOptions.parser, tsParser);
  assert.deepEqual(appBlock.languageOptions.parserOptions, { ecmaFeatures: { jsx: true } });
  assert.equal(appBlock.plugins.shadcn, shadcnPlugin);
  assert.equal(appBlock.plugins["house-rules"], housePlugin);
  assert.equal(appBlock.settings, undefined);
  assert.deepEqual(appBlock.rules, RECOMMENDED_RULES);
  assert.deepEqual(componentBlock.files, [["**/components/ui/**", "**/*.{jsx,tsx}"]]);
  assert.equal(componentBlock.plugins.shadcn, shadcnPlugin);
  assert.deepEqual(componentBlock.rules, {
    "shadcn/no-restyle": "off",
    "shadcn/no-arbitrary-values": "off",
    "shadcn/require-static-classes": "off",
    "house-rules/design-no-raw-element": "off",
  });
});

test("shadcn() options: files, component folders, a global severity, per-rule overrides, and settings", () => {
  const [appBlock, componentBlock] = shadcn({
    files: ["apps/web/**/*.tsx"],
    components: ["apps/web/src/ui/**", "packages/ui/**"],
    severity: "warn",
    rules: {
      "no-restyle": { contracts: [{ pattern: "^Card$", allow: ["layout", "spacing"] }] },
      "no-raw-colors": "error",
      "no-arbitrary-values": ["error", { allow: ["layout", "spacing"] }],
      "no-inline-styles": false,
      "no-unknown-classes": ["error", { allow: ["editor-root"] }],
    },
    settings: { ui: "@/ui" },
  });
  assert.deepEqual(appBlock.files, ["apps/web/**/*.tsx"]);
  assert.deepEqual(appBlock.settings, { shadcn: { ui: "@/ui" } });
  assert.deepEqual(appBlock.rules, {
    "shadcn/no-restyle": [
      "warn",
      { allow: ["layout"], contracts: [{ pattern: "^Card$", allow: ["layout", "spacing"] }] },
    ],
    "shadcn/no-raw-colors": "error",
    "shadcn/no-arbitrary-values": ["error", { allow: ["layout", "spacing"] }],
    "shadcn/no-inline-styles": "off",
    "shadcn/require-static-classes": "warn",
    "shadcn/no-unknown-classes": ["error", { allow: ["editor-root"] }],
    "house-rules/design-no-raw-element": [
      "warn",
      { components: ["apps/web/src/ui/**", "packages/ui/**"] },
    ],
  });
  assert.deepEqual(componentBlock.files, [
    ["apps/web/src/ui/**", "apps/web/**/*.tsx"],
    ["packages/ui/**", "apps/web/**/*.tsx"],
  ]);
  assert.equal(shadcn({ components: false }).length, 1);
  assert.deepEqual(shadcn({ rules: { "no-restyle": "warn" } })[0].rules["shadcn/no-restyle"], [
    "warn",
    { allow: ["layout"] },
  ]);
  assert.throws(() => shadcn({ rules: { "no-raw-color": false } }), /unknown rule "no-raw-color"/);
  assert.throws(() => shadcn({ severity: "warning" }), /severity must be one of off, warn, error/);
  assert.throws(() => shadcn({ rules: { "no-restyle": ["loud", {}] } }), /must be one of/);
  assert.throws(() => shadcn({ files: "**/*.tsx" }), /files must be an array/);
  assert.throws(() => shadcn({ components: "ui/**" }), /components must be an array/);
  assert.throws(() => shadcn({ settings: "ui" }), /settings must be an object/);
});

test("shadcn() rawElements: off, a severity, options, and the global severity", () => {
  const entry = (options) => shadcn(options)[0].rules["house-rules/design-no-raw-element"];
  assert.equal(entry({ rawElements: false }), "off");
  assert.deepEqual(entry({ rawElements: "warn" }), [
    "warn",
    { components: ["**/components/ui/**"] },
  ]);
  assert.deepEqual(entry({ severity: "warn", rawElements: { severity: "error" } })[0], "error");
  assert.deepEqual(
    entry({
      components: ["app/_components/ui/**"],
      rawElements: { elements: { a: { use: "Link" } }, allow: ["app/global-error.tsx"] },
    }),
    [
      "error",
      {
        elements: { a: { use: "Link" } },
        allow: ["app/global-error.tsx"],
        components: ["app/_components/ui/**"],
      },
    ],
  );
  assert.equal(entry({ rawElements: { severity: "off" } }), "off");
  assert.deepEqual(entry({ components: false }), "error");
  assert.deepEqual(entry({ components: false, rawElements: { components: ["ui/**"] } }), [
    "error",
    { components: ["ui/**"] },
  ]);
  assert.throws(() => shadcn({ rawElements: { map: {} } }), /unknown rawElements option "map"/);
  assert.throws(() => shadcn({ rawElements: "loud" }), /must be one of/);
  assert.throws(() => shadcn({ rawElements: [] }), /rawElements must be false/);
  assert.throws(
    () => shadcn({ rawElements: { allow: "x" } }),
    /rawElements.allow must be an array/,
  );
});

test("fixture app: shadcn() reports a raw element outside the component folder only", async () => {
  const app = path.resolve(import.meta.dirname, "fixtures/raw-element-app");
  const eslint = new ESLint({ cwd: app, overrideConfigFile: true, overrideConfig: shadcn() });
  const results = await eslint.lintFiles(["src"]);
  const raw = results.flatMap(({ filePath, messages }) =>
    messages
      .filter(({ ruleId }) => ruleId === "house-rules/design-no-raw-element")
      .map(({ line }) => `${path.relative(app, filePath).split(path.sep).join("/")}:${line}`),
  );
  assert.deepEqual(raw.sort(), [
    "src/pages/form.tsx:10",
    "src/pages/form.tsx:6",
    "src/pages/form.tsx:7",
    "src/pages/global-error.tsx:3",
  ]);
});

test("shadcn() validates rules and each rule entry", () => {
  for (const rules of [false, 42, [], null, "error"]) {
    assert.throws(() => shadcn({ rules }), /rules must be an object/, JSON.stringify(rules));
  }
  for (const bad of [
    ["error", false],
    ["error", "layout"],
    ["error", []],
    ["error", {}, {}],
    ["error"],
    [],
    42,
    null,
  ]) {
    assert.throws(
      () => shadcn({ rules: { "no-restyle": bad } }),
      /rules\["no-restyle"\] must be false, a severity, an options object, or \[severity, options\]/,
      JSON.stringify(bad),
    );
  }
  assert.throws(() => shadcn({ rules: { "no-restyle": ["loud", {}] } }), /must be one of/);
});

test("only the /shadcn entry loads @shadcn/lint", async () => {
  assert.equal((await packagesLoadedBy("index.mjs")).has("@shadcn/lint"), false);
  assert.equal((await packagesLoadedBy("design.mjs")).has("@shadcn/lint"), false);
  assert.equal((await packagesLoadedBy("shadcn.mjs")).has("@shadcn/lint"), true);
});

test("fixture app: the page reports one message per shadcn rule, and the component folder is exempt", async () => {
  assert.deepEqual(await lint(shadcn()), HOME_FINDINGS);
  // No tailwindcss is installed here, so no-unknown-classes falls back to the plugin's bundled grammar.
  assert.ok(
    pluginWarnings.some((warning) =>
      /no-unknown-classes is using the grammar bundled/.test(warning),
    ),
    pluginWarnings.join("\n"),
  );
  assert.deepEqual(
    await lint(shadcn({ components: false })),
    [BUTTON_ARBITRARY, ...HOME_FINDINGS].sort((left, right) =>
      left.localeCompare(right, "en", { numeric: true }),
    ),
  );
});

test("fixture app: severity overrides change only the named rules", async () => {
  const findings = await lint(
    shadcn({ rules: { "no-inline-styles": "warn", "no-unknown-classes": false } }),
  );
  assert.deepEqual(
    findings,
    HOME_FINDINGS.filter((line) => !line.includes("no-unknown-classes")).map((line) =>
      line.includes("no-inline-styles") ? line.replace(" error ", " warn ") : line,
    ),
  );
  const allWarn = await lint(shadcn({ severity: "warn" }));
  assert.deepEqual(
    allWarn,
    HOME_FINDINGS.map((line) => line.replace(" error ", " warn ")),
  );
});

// The partly verdict in docs/shadcn.md: scanAllStrings reads the class-like "bg-pink-500", not the colour constants.
test("overlap: a standalone colour constant passes every shadcn rule but fails design-no-raw-color-literal", async () => {
  const everyStringScanned = shadcn({
    files: ["src/pages/brand.ts"],
    components: false,
    rules: {
      "no-raw-colors": { scanAllStrings: true },
      "no-arbitrary-values": { scanAllStrings: true },
    },
  });
  assert.deepEqual(await lint(everyStringScanned, ["src/pages/brand.ts"]), [SALE_FINDING]);
  const designSource = design({ css: false, source: { files: ["src/pages/brand.ts"] } });
  assert.deepEqual(await lint(designSource, ["src/pages/brand.ts"]), [
    'src/pages/brand.ts:1:23 error house-rules/design-no-raw-color-literal Raw colour "#ffffff" in a string. Use a design token, such as var(--name) or a theme constant.',
    'src/pages/brand.ts:2:24 error house-rules/design-no-raw-color-literal Raw colour "rgb(1, 2, 3)" in a string. Use a design token, such as var(--name) or a theme constant.',
  ]);
});

// The gaps between board-app's local utility test and the preset: docs/shadcn.md, "Stricter utility checks".
test("gaps: the strict settings and classColors report what the default preset lets through", async () => {
  const GAPS = "gaps/utilities.tsx";
  const rules = (findings) => findings.map((line) => line.split(" ").slice(0, 3).join(" "));
  assert.deepEqual(await lint(shadcn(), [GAPS]), []);
  const strict = shadcn({
    rules: {
      "no-arbitrary-values": { allow: [], scanAllStrings: true },
      "no-raw-colors": { scanAllStrings: true },
    },
  });
  assert.deepEqual(rules(await lint(strict, [GAPS])), [
    `${GAPS}:1:30 error shadcn/no-raw-colors`,
    `${GAPS}:1:52 error shadcn/no-arbitrary-values`,
    `${GAPS}:6:22 error shadcn/no-arbitrary-values`,
    `${GAPS}:7:22 error shadcn/no-arbitrary-values`,
  ]);
  const classColors = design({
    css: false,
    source: { files: ["**/*.tsx"] },
    rules: { "design-no-raw-color-literal": { classColors: ["white", "black"] } },
  });
  assert.deepEqual(rules(await lint(classColors, [GAPS])), [
    `${GAPS}:8:23 error house-rules/design-no-raw-color-literal`,
    `${GAPS}:8:32 error house-rules/design-no-raw-color-literal`,
  ]);
});
