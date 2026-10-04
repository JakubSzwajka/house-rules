import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import css from "@eslint/css";
import tsParser from "@typescript-eslint/parser";
import plugin from "../src/index.mjs";
import design, { design as namedDesign } from "../src/design.mjs";
import { HOSTI, HOSTI_SCALES, countByRule, lintWith } from "./design-helpers.mjs";

const HOSTI_APP = {
  tokenFiles: ["apps/web/src/styles/hosti.css"],
  css: { files: ["apps/**/*.css"] },
  source: { files: ["apps/**/*.{ts,tsx}"] },
  rules: { "design-scale-value": HOSTI_SCALES },
};

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
  return { files: seen, packages };
}

test("design() returns a CSS block and a source block with the token files passed to the CSS rules", () => {
  assert.equal(namedDesign, design);
  const [cssBlock, sourceBlock, ...rest] = design({ tokenFiles: ["tokens.css"] });
  assert.equal(rest.length, 0);
  assert.deepEqual(cssBlock.files, ["**/*.css"]);
  assert.equal(cssBlock.language, "css/css");
  assert.equal(cssBlock.plugins.css, css);
  assert.equal(cssBlock.plugins["house-rules"], plugin);
  assert.deepEqual(cssBlock.rules, {
    "house-rules/design-no-raw-color": ["error", { tokenFiles: ["tokens.css"] }],
    "house-rules/design-no-unknown-token": ["error", { tokenFiles: ["tokens.css"] }],
    "house-rules/design-scale-value": "off",
  });
  assert.deepEqual(sourceBlock.files, ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
  assert.equal(sourceBlock.languageOptions.parser, tsParser);
  assert.deepEqual(sourceBlock.rules, { "house-rules/design-no-raw-color-literal": "error" });
});

test("design() options: per-rule options, false turns a rule off, and blocks can be skipped", () => {
  const [cssBlock, sourceBlock] = design({
    tokenFiles: ["a.css"],
    rules: {
      "design-no-raw-color": { allowIn: ["legacy/**"], suggestNearest: false },
      "design-no-unknown-token": false,
      "design-scale-value": [{ property: "radius", allowed: ["4px"] }],
      "design-no-raw-color-literal": { skipVarFallback: false },
    },
  });
  assert.deepEqual(cssBlock.rules, {
    "house-rules/design-no-raw-color": [
      "error",
      { tokenFiles: ["a.css"], allowIn: ["legacy/**"], suggestNearest: false },
    ],
    "house-rules/design-no-unknown-token": "off",
    "house-rules/design-scale-value": ["error", [{ property: "radius", allowed: ["4px"] }]],
  });
  assert.deepEqual(sourceBlock.rules, {
    "house-rules/design-no-raw-color-literal": ["error", { skipVarFallback: false }],
  });
  assert.deepEqual(
    design({ source: false }).map(({ language }) => language),
    ["css/css"],
  );
  assert.deepEqual(
    design({ css: false }).map(({ language }) => language),
    [undefined],
  );
  assert.throws(() => design({ rules: { "no-raw-color": false } }), /unknown rule "no-raw-color"/);
  assert.throws(() => design({ tokenFiles: "tokens.css" }), /tokenFiles must be an array/);
});

test("the package root registers the design rules without loading @eslint/css", async () => {
  const { files, packages } = await packagesLoadedBy("index.mjs");
  for (const rule of [
    "design-no-raw-color",
    "design-no-raw-color-literal",
    "design-no-unknown-token",
    "design-scale-value",
  ]) {
    assert.ok(plugin.rules[rule], rule);
  }
  assert.ok(files.has("design-tokens.mjs"));
  assert.equal(packages.has("@eslint/css"), false, [...packages].join(", "));
  assert.equal(files.has("design.mjs"), false);
  assert.deepEqual(Object.keys(plugin.configs), ["recommended", "capability"]);
  assert.equal((await packagesLoadedBy("design.mjs")).packages.has("@eslint/markdown"), false);
});

test("Hosti parity: the app styles and sources report the probe's real cases", async () => {
  const findings = await lintWith(HOSTI, design(HOSTI_APP), ["apps"]);
  assert.deepEqual(countByRule(findings), {
    "design-no-raw-color": 9,
    "design-no-raw-color-literal": 3,
    "design-scale-value": 1,
  });
  const where = findings.map(
    ({ file, rule, line, column, message }) => `${file}:${line}:${column} ${rule} ${message}`,
  );
  assert.deepEqual(where, [
    'apps/web/src/server/serving/respond.ts:10:40 design-no-raw-color-literal Raw colour "#1c1917" in a string. Use a design token, such as var(--name) or a theme constant.',
    'apps/web/src/server/serving/respond.ts:10:61 design-no-raw-color-literal Raw colour "#fafaf9" in a string. Use a design token, such as var(--name) or a theme constant.',
    'apps/web/src/server/serving/respond.ts:11:26 design-no-raw-color-literal Raw colour "#f5f5f4" in a string. Use a design token, such as var(--name) or a theme constant.',
    'apps/web/src/styles/grid.css:4:18 design-scale-value border-radius "2px 2px 0 0" has values off the scale: 0. Allowed: 2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 999px.',
    'apps/web/src/styles/grid.css:5:15 design-no-raw-color Raw colour "#c5cdcf". Use a design token; the nearest is var(--line).',
    'apps/web/src/styles/grid.css:18:15 design-no-raw-color Raw colour "#fff". Use a design token; the nearest is var(--card).',
    'apps/web/src/styles/grid.css:32:42 design-no-raw-color Raw colour "rgba(248, 253, 255, 0)". Use a design token; the nearest is var(--card).',
    'apps/web/src/styles/grid.css:37:15 design-no-raw-color Raw colour "#e8f4f5". Use a design token; the nearest is var(--paper).',
    'apps/web/src/styles/hosti.css:29:56 design-no-raw-color Raw colour "rgba(43, 49, 51, 0.08)". Use a design token; the nearest is var(--ink).',
    'apps/web/src/styles/hosti.css:38:15 design-no-raw-color Raw colour "#bfe0e3". Use a design token; the nearest is var(--line-soft).',
    'apps/web/src/styles/hosti.css:43:20 design-no-raw-color Raw colour "#b3bbbd". Use a design token; the nearest is var(--line).',
    'apps/web/src/styles/hosti.css:50:15 design-no-raw-color Raw colour "#b3bbbd". Use a design token; the nearest is var(--line).',
    'apps/web/src/styles/hosti.css:55:15 design-no-raw-color Raw colour "#98a2a4". Use a design token; the nearest is var(--line).',
  ]);
});

test("Hosti parity: landing custom-property colours, an undefined --bar, and a hand-timed transition", async () => {
  const findings = await lintWith(
    HOSTI,
    design({
      tokenFiles: ["landing/styles/tokens.css"],
      css: { files: ["landing/**/*.css"] },
      source: false,
      rules: {
        "design-scale-value": HOSTI_SCALES,
        "design-no-raw-color": { suggestNearest: false },
      },
    }),
    ["landing"],
  );
  assert.deepEqual(countByRule(findings), {
    "design-no-raw-color": 8,
    "design-scale-value": 1,
    "design-no-unknown-token": 1,
  });
  assert.deepEqual(
    findings
      .filter(({ file }) => file.endsWith("sections.css"))
      .map(({ line, rule }) => `${line} ${rule}`),
    [2, 3, 4, 5, 6, 7, 8]
      .map((line) => `${line} design-no-raw-color`)
      .concat(["18 design-scale-value", "24 design-no-unknown-token"]),
  );
});
