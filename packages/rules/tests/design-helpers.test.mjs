import assert from "node:assert/strict";
import { utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { nearestToken, parseColor } from "../src/colors.mjs";
import { scanCssValue } from "../src/css-values.mjs";
import { customPropertyDefinitions, readTokens } from "../src/design-tokens.mjs";
import { compileGlob, matchesAnyGlob } from "../src/file-globs.mjs";
import { findColorLiterals } from "../src/design-no-raw-color-literal.mjs";
import { ACME, ACME_TOKENS, removeDirectory, temporaryDirectory } from "./design-helpers.mjs";

test("custom-property definitions are read in source order, skipping comments and nested values", () => {
  const css = `/* --commented: red; */
:root { --a: #fff; --b:var(--a);--grid: { x: 1 }; }
@media (prefers-color-scheme: dark) { :root { --a: #000 !important; } }
.x { color: var(--a); --url: url("a;b.svg"); }`;
  assert.deepEqual(customPropertyDefinitions(css), [
    { name: "--a", value: "#fff" },
    { name: "--b", value: "var(--a)" },
    { name: "--grid", value: "{ x: 1 }" },
    { name: "--a", value: "#000" },
    { name: "--url", value: 'url("a;b.svg")' },
  ]);
});

test("token files resolve from cwd, keep the first definition, and follow var() aliases for colours", () => {
  const root = temporaryDirectory({
    "styles/tokens.css":
      ":root { --ink: #2b3133; --text: var(--ink); --gap: 22px; }\n.dark { --ink: #fff; }",
  });
  try {
    const tokens = readTokens(root, ["styles/tokens.css"]);
    assert.deepEqual([...tokens.names], ["--ink", "--text", "--gap"]);
    assert.deepEqual(
      tokens.palette.map(({ name }) => name),
      ["--ink", "--text"],
    );
    assert.equal(tokens.isTokenFile(path.join(root, "styles/tokens.css")), true);
    assert.equal(tokens.isTokenFile("styles/tokens.css"), true);
    assert.equal(tokens.isTokenFile("styles/other.css"), false);
  } finally {
    removeDirectory(root);
  }
});

test("the token cache refreshes when a token file's mtime or size changes", () => {
  const root = temporaryDirectory({ "tokens.css": ":root { --a: #fff; }" });
  const file = path.join(root, "tokens.css");
  try {
    assert.deepEqual([...readTokens(root, ["tokens.css"]).names], ["--a"]);
    writeFileSync(file, ":root { --b: #fff; }");
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);
    assert.deepEqual([...readTokens(root, ["tokens.css"]).names], ["--b"]);
    writeFileSync(file, ":root { --z: #fff; }");
    utimesSync(file, past, past);
    assert.deepEqual(
      [...readTokens(root, ["tokens.css"]).names],
      ["--b"],
      "same mtime and size is a cache hit",
    );
    writeFileSync(file, ":root { --b: #fff; --c: #000; }");
    assert.deepEqual([...readTokens(root, ["tokens.css"]).names], ["--b", "--c"]);
  } finally {
    removeDirectory(root);
  }
});

test("a missing token file is a configuration error", () => {
  assert.throws(
    () => readTokens(ACME, ["missing.css"]),
    /token file ".*missing\.css" does not exist/,
  );
});

test("colours parse to sRGB and the nearest token uses OKLab distance", () => {
  const channels = (text) => {
    const color = parseColor(text);
    return (
      color && [color.r, color.g, color.b, color.alpha].map((value) => Math.round(value * 255))
    );
  };
  assert.deepEqual(channels("#0f08"), [0, 255, 0, 136]);
  assert.deepEqual(channels("rgba(43, 49, 51, 0.5)"), [43, 49, 51, 128]);
  assert.deepEqual(channels("rgb(100% 0% 0% / 25%)"), [255, 0, 0, 64]);
  assert.deepEqual(channels("hsl(120deg 100% 25%)"), [0, 128, 0, 255]);
  assert.deepEqual(channels("hwb(0 0% 0%)"), [255, 0, 0, 255]);
  assert.deepEqual(channels("RebeccaPurple"), [102, 51, 153, 255]);
  assert.deepEqual(channels("oklch(0.62796 0.25768 29.2339)"), [255, 0, 0, 255]);
  assert.equal(parseColor("lab(50% 10 10)"), null);
  assert.equal(parseColor("var(--ink)"), null);

  const palette = readTokens(ACME, [ACME_TOKENS]).palette;
  assert.equal(nearestToken(parseColor("#e8f4f5"), palette).name, "--paper");
  assert.equal(nearestToken(parseColor("#c5cdcf"), palette).name, "--line");
  assert.equal(nearestToken(parseColor("#1b2123"), palette).name, "--ink");
});

test("the CSS value scanner separates colours, names, var() references and fallbacks", () => {
  const items = scanCssValue(
    ' 0 1px #abc, rgb(var(--x) / 50%) url(#fff) "red" var(--a, #000) -webkit-red 10px-red --red',
  );
  assert.deepEqual(
    items.map(({ type, text, inFallback, inColorFunction, hasVar }) => [
      type,
      text,
      inFallback,
      inColorFunction,
      hasVar,
    ]),
    [
      ["hex", "#abc", false, false, undefined],
      ["color-function", "rgb(var(--x) / 50%)", false, false, true],
      ["var", "--x", false, true, undefined],
      ["var", "--a", false, false, undefined],
      ["hex", "#000", true, false, undefined],
      ["identifier", "-webkit-red", false, false, undefined],
      ["identifier", "--red", false, false, undefined],
    ],
  );
});

test("string colour matching skips entities, URL fragments and optional var() fallbacks", () => {
  const found = (text, options) =>
    findColorLiterals(text, options).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found("&#8599; a.html#fade #fff (#000) x:#abcd =#123456"), [
    "#fff",
    "#000",
    "#abcd",
    "#123456",
  ]);
  assert.deepEqual(found("var(--pop, #06707e)"), []);
  assert.deepEqual(found("var(--pop, #06707e)", { skipVarFallback: false }), ["#06707e"]);
});

test("string colour matching skips CSS attribute selector values and URLs", () => {
  const found = (text) => findColorLiterals(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(found('[data-id="#add"]'), []);
  assert.deepEqual(found("a[href^='#cafe'], [data-x=#bead], [title~=\"#fff\"]"), []);
  assert.deepEqual(found("https://x.test/?q=#fff"), []);
  assert.deepEqual(found("/search?a=1&q=#fff"), []);
  assert.deepEqual(found('<link href="https://x.test/#fade"><style>a { color: #fff }</style>'), [
    "#fff",
  ]);
  assert.deepEqual(found('<rect fill="#fff" />'), ["#fff"]);
});

test("globs match paths relative to cwd", () => {
  assert.equal(compileGlob("**/*.{ts,tsx}").test("a/b/c.tsx"), true);
  assert.equal(compileGlob("**/*.{ts,tsx}").test("c.ts"), true);
  assert.equal(compileGlob("src/*.css").test("src/a/b.css"), false);
  assert.equal(compileGlob("src/[ab]?.css").test("src/a1.css"), true);
  assert.equal(compileGlob("{src,lib/**}/*.css").test("lib/a/b.css"), true);
  assert.equal(compileGlob("src/**/theme/*.ts").test("src/theme/x.ts"), true);
  assert.equal(matchesAnyGlob("/repo/landing/x.css", "/repo", ["./landing/**"]), true);
  assert.equal(matchesAnyGlob("/repo/apps/x.css", "/repo", ["landing/**"]), false);
});

test("globs skip dotfiles and dot directories unless the pattern names the dot", () => {
  assert.equal(matchesAnyGlob("/repo/.env.ts", "/repo", ["**/*.ts"]), false);
  assert.equal(matchesAnyGlob("/repo/.github/x.ts", "/repo", ["**/*.ts"]), false);
  assert.equal(matchesAnyGlob("/repo/.github/x.ts", "/repo", ["**"]), false);
  assert.equal(matchesAnyGlob("/repo/.github/x.ts", "/repo", [".github/**"]), true);
  assert.equal(matchesAnyGlob("/repo/.github/x.ts", "/repo", ["./.github/*.ts"]), true);
  assert.equal(matchesAnyGlob("/repo/.env.ts", "/repo", ["**/.env.ts"]), true);
  assert.equal(matchesAnyGlob("/repo/.env.ts", "/repo", ["?env.ts"]), false);
});

test("repeated ** segments match in linear time", () => {
  const started = performance.now();
  assert.equal(compileGlob(`${"**/".repeat(20)}Z`).test("a/".repeat(40)), false);
  assert.equal(compileGlob(`${"**/a/".repeat(20)}Z`).test("a/".repeat(200)), false);
  assert.equal(compileGlob(`${"**/".repeat(20)}Z`).test(`${"a/".repeat(40)}Z`), true);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `took ${elapsed.toFixed(1)} ms`);
});
