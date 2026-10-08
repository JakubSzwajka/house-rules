import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import plugin from "../src/index.mjs";

function createEslint() {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended,
  });
}

async function lint(code, filePath) {
  const [result] = await createEslint().lintText(code, { filePath });
  return result.messages;
}

test("exports plugin metadata and a flat preset for every supported extension", () => {
  assert.deepEqual(plugin.meta, {
    name: "@house-rules/rules",
    version: "0.10.0",
  });
  assert.deepEqual(plugin.configs.recommended[0].files, ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
  assert.equal(plugin.configs.recommended[0].plugins["house-rules"], plugin);
  assert.equal(plugin.configs.recommended[0].rules["house-rules/comment-discipline"], "error");
});

test("lints JavaScript, TypeScript, JSX, TSX, MJS, CJS, MTS, and CTS through ESLint", async () => {
  const fixtures = [
    [
      "subject.js",
      "function run() {\n  // The retry must stay bounded by the caller's deadline.\n  return true;\n}",
    ],
    [
      "subject.ts",
      "function run(value: string): string {\n  // The parser keeps this boundary typed.\n  return value;\n}",
    ],
    [
      "subject.jsx",
      "const View = () => <div>{/* Keep this outside the focus ring. */}<button /></div>;",
    ],
    [
      "subject.tsx",
      "const View = ({ label }: { label: string }) => <span>{/* Screen readers need the full label. */}{label}</span>;",
    ],
    ["subject.mjs", "// SPDX-License-Identifier: MIT\nexport const value = 1;"],
    ["subject.cjs", "/* @preserve bundled notice */\nmodule.exports = 1;"],
    ["subject.mts", '/// <reference types="node" />\nexport const value = 1;'],
    ["subject.cts", "// @ts-check\nmodule.exports = { value: 1 };"],
  ];

  for (const [filePath, code] of fixtures) {
    assert.deepEqual(await lint(code, filePath), [], filePath);
  }
});

test("allows legal and tool directives, including CRLF and Unicode line grouping", async () => {
  const code = [
    "// SPDX-License-Identifier: MIT",
    "// biome-ignore lint/style/useConst: generated protocol shape",
    "function run() {",
    "  // The first line explains the constraint.",
    "  // The second line is the same rationale group.",
    "  return true;",
    "}",
  ].join("\r\n");
  const directive = "/* eslint-disable-next-line no-console */\nconsole.log('allowed');";
  const unicodeLines =
    "function run() {\u2028  // The runtime can retry after a clock step.\u2028  return true;\u2028}";

  assert.deepEqual(await lint(code, "directives.ts"), [
    {
      ruleId: "house-rules/comment-discipline",
      severity: 2,
      message: plugin.rules["comment-discipline"].meta.messages.rework,
      line: 4,
      column: 3,
      messageId: "rework",
      endLine: 5,
      endColumn: 50,
    },
  ]);
  assert.deepEqual(await lint(directive, "directive.js"), []);
  assert.deepEqual(await lint(unicodeLines, "unicode.mjs"), []);
});

test("rejects top-level, multiline, and narrative comments with one diagnostic per group", async () => {
  const code = `// This top-level narrative does not explain a constrained line.
const value = 1;

function run() {
  /* A block comment starts here.
   * It continues on another physical line. */
  // First narrative line.
  // Second narrative line.
  return value;
}`;
  const messages = await lint(code, "rejected.tsx");

  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages.map(({ ruleId, line, endLine }) => ({ ruleId, line, endLine })),
    [
      { ruleId: "house-rules/comment-discipline", line: 1, endLine: 1 },
      { ruleId: "house-rules/comment-discipline", line: 5, endLine: 6 },
      { ruleId: "house-rules/comment-discipline", line: 7, endLine: 8 },
    ],
  );
});
