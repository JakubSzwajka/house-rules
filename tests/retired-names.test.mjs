import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { parseSync } from "@swc/core";

const root = resolve(import.meta.dirname, "..");
const self = "tests/retired-names.test.mjs";
const skipped = new Set([
  "node_modules",
  "dist",
  "build",
  ".astro",
  ".next",
  "coverage",
  ".turbo",
  ".git",
]);
const retired = [
  /\bdefineContract\b/u,
  /\bimplement\s*\(/u,
  /\btoTool\b/u,
  /\buse-case-is-capability\b/u,
  /\bcapabilityConfig\b/u,
  /\bconfigs\.capability\b/u,
  /\b(?:use-cases|delivery)\//u,
  /\bsrc\/(?:nodes|modules)\//u,
  /\b(?:booking-platform|booking-v2|rejected-shapes)\b/u,
];
const allowlist = [
  {
    path: "scripts/packed-consumer.mjs",
    line: 'for (const name of ["implement", "defineContract", "Grant", "route", "toTool", "toMcpHandler", "mount", "problemView"])',
    reason: "Cold-consumer fixture asserts that these application exports are absent.",
  },
  {
    path: "scripts/packed-consumer.mjs",
    line: 'for (const name of ["defineContract", "toTool", "NoInput", "defineNode", "errorKind"])',
    reason: "Cold-consumer fixture asserts that these contract exports are absent.",
  },
  {
    path: "scripts/packed-consumer.mjs",
    line: "      'assert.equal(Object.hasOwn(rules.rules, \"use-case-is-capability\"), false);',",
    reason: "Cold-consumer fixture asserts that the retired rule is absent.",
  },
  {
    path: "site/src/content/docs/rules/index.md",
    line: '| <span id="use-case-is-capability"></span><span id="node-file"></span>[`node-file`](#node-file) | ESLint | Require one direct `node.ts` descriptor, own-node `handler.ts` binding and optional own-node `entry.ts` Entry; allow type exports. | [docs](https://github.com/JakubSzwajka/house-rules/blob/main/packages/rules/docs/node-file.md) |',
    reason: "Generated alias preserves the published rule anchor.",
  },
];

function matches(path, line) {
  if (allowlist.some((entry) => entry.path === path && entry.line === line)) return false;
  return (
    retired.some((pattern) => pattern.test(line)) ||
    (path === "migrations.json" && /["']folder["']\s*:/u.test(line))
  );
}

function files(path) {
  if (!existsSync(resolve(root, path))) return [];
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name) || entry.isSymbolicLink()) return [];
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? files(child) : [child];
  });
}

function liveFiles() {
  const paths = [
    "eslint.config.mjs",
    ".dependency-cruiser.cjs",
    "biome.json",
    "turbo.json",
    "pnpm-workspace.yaml",
    "package.json",
    "migrations.json",
    "AGENTS.md",
    "CONTEXT.md",
    "README.md",
  ];
  for (const entry of readdirSync(resolve(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = `packages/${entry.name}`;
    paths.push(...files(`${base}/src`), ...files(`${base}/bin`));
    for (const name of ["package.json", "AGENTS.md", "README.md", "CONTEXT.md"]) {
      if (existsSync(resolve(root, base, name))) paths.push(`${base}/${name}`);
    }
  }
  for (const path of [
    "packages/rules/docs",
    "examples",
    "scripts",
    "tests",
    "site/src",
    "skills",
    ".github/workflows",
  ]) {
    paths.push(...files(path));
  }
  return paths.filter((path) => path !== self);
}

test("live files contain no code-shaped retired names", () => {
  const hits = [];
  for (const path of liveFiles()) {
    if (matches(path, path)) hits.push(`${path}: retired path`);
    const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (matches(path, line)) hits.push(`${path}:${index + 1}: ${line}`);
    });
    const checked = lines.map((line) =>
      allowlist.some((entry) => entry.path === path && entry.line === line) ? "" : line,
    );
    if (!lines.some((line) => matches(path, line)) && matches(path, checked.join("\n"))) {
      hits.push(`${path}: retired name split across lines`);
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("matcher rejects retired code but allows ordinary prose", () => {
  for (const line of [
    "defineContract({})",
    "implement (node)",
    "implement\n(node)",
    '"folder"\n: "somewhere"',
    "toTool(entry)",
    "use-case-is-capability",
    "capabilityConfig({})",
    "configs.capability",
    "src/use-cases/book.ts",
    "./delivery/http.ts",
    "apps/api/src/nodes/book/node.ts",
    "apps/api/src/modules/books/index.ts",
    '"folder": "somewhere"',
    "booking-platform",
    "booking-v2",
    "rejected-shapes",
  ])
    assert.equal(matches("migrations.json", line), true, line);
  for (const line of [
    "We implement delivery for each node and module.",
    "defineNode",
    "bindNode",
    "nodesConfig",
    "configs.nodes",
    "src/features/book/node.ts",
    "src/read-models/books/index.ts",
    '{ "workspace": "packages/books" }',
    '{ "package": "@house-rules/comments" }',
  ])
    assert.equal(matches("migrations.json", line), false, line);
});

test("allowlist is exact, not a whole-file exemption", () => {
  for (const entry of allowlist) {
    assert.ok(entry.reason);
    assert.ok(readFileSync(resolve(root, entry.path), "utf8").split(/\r?\n/u).includes(entry.line));
    assert.equal(matches(entry.path, entry.line), false);
    assert.equal(matches(entry.path, "defineContract({})"), true);
    assert.equal(matches(entry.path, `${entry.line} defineContract({})`), true);
    assert.equal(matches("elsewhere.mjs", entry.line), true);
  }
});

test("no public package index exports a retired API name", () => {
  const names = new Set(["defineContract", "implement", "toTool", "capabilityConfig"]);
  const hits = [];
  for (const entry of readdirSync(resolve(root, "packages"), { withFileTypes: true })) {
    const manifestPath = `packages/${entry.name}/package.json`;
    if (!entry.isDirectory() || !existsSync(resolve(root, manifestPath))) continue;
    if (JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")).private) continue;
    const path = `packages/${entry.name}/src/index.ts`;
    if (!existsSync(resolve(root, path))) continue;
    const source = parseSync(readFileSync(resolve(root, path), "utf8"), { syntax: "typescript" });
    for (const statement of source.body) {
      if (statement.type === "ExportNamedDeclaration") {
        for (const specifier of statement.specifiers) {
          const name = (specifier.exported ?? specifier.orig)?.value;
          if (names.has(name)) hits.push(`${path}: ${name}`);
        }
      }
      if (statement.type === "ExportDeclaration") {
        const declaration = statement.declaration;
        const name = declaration.identifier?.value;
        if (names.has(name)) hits.push(`${path}: ${name}`);
        for (const variable of declaration.declarations ?? []) {
          if (names.has(variable.id.value)) hits.push(`${path}: ${variable.id.value}`);
        }
      }
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});
