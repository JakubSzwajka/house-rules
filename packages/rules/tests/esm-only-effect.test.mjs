import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import { featuresConfig } from "../src/index.mjs";

const root = mkdtempSync(path.join(tmpdir(), "esm-effect-"));
for (const [folder, json] of Object.entries({
  "apps/tests": {},
  "apps/test": {},
  "packages/tests": { dependencies: { effect: "4.0.3" } },
  "packages/test": { devDependencies: { effect: "4.0.3" } },
  "packages/domain": { name: "@house-rules/domain" },
  "packages/application": { name: "@house-rules/application" },
  "packages/plain": {},
  "packages/rules": { name: "@house-rules/rules", dependencies: { effect: "4.0.3" } },
})) {
  mkdirSync(path.join(root, folder), { recursive: true });
  writeFileSync(path.join(root, folder, "package.json"), JSON.stringify(json));
}
const lint = (code, file) =>
  new Linter({ cwd: root })
    .verify(code, featuresConfig(), { filename: path.join(root, file) })
    .filter((m) => m.ruleId === "house-rules/esm-only-effect" || m.fatal)
    .map((m) => m.messageId ?? m.message);
const forms = [
  'require("node:path")',
  'const load = require; load("node:path")',
  'let load = require; load("node:path")',
  'module.require("node:path")',
  '(0, require)("node:path")',
  'require.call(null, "node:path")',
  'import { createRequire as make } from "node:module"; let load = make(import.meta.url); load("node:path")',
  'import M from "module"; M.createRequire(import.meta.url)("node:path")',
  'import * as M from "node:module"; const alias = M; alias.createRequire(import.meta.url)("node:path")',
  'import * as M from "module"; let alias = M; const { createRequire: make } = alias; make(import.meta.url)',
  'import M = require("node:path")',
];
for (const folder of [
  "apps/tests",
  "apps/test",
  "packages/tests",
  "packages/test",
  "packages/domain",
  "packages/application",
])
  for (const code of forms)
    it(`requires ESM in ${folder}: ${code}`, () =>
      assert.deepEqual(lint(code, `${folder}/src/composition/main.ts`), ["esm"]));
for (const code of [
  'function f(require) { require("x") }',
  'const module = { require: (x) => x }; module.require("x")',
  "const createRequire = () => 1; createRequire()",
  'import { createRequire } from "other"; createRequire()',
  'import * as M from "node:module"; M.isBuiltin("node:path")',
  "const security = { require: [] }; export { security }",
])
  it(`keeps unrelated identities: ${code}`, () =>
    assert.deepEqual(lint(code, "apps/tests/src/main.ts"), []));
for (const file of [
  "packages/plain/src/main.js",
  "apps/tests/scripts/main.ts",
  "apps/tests/src/tests/main.ts",
  "packages/tests/src/test/main.ts",
  "scripts/main.mjs",
])
  it(`keeps nonproduction/nonEffect scope: ${file}`, () =>
    assert.deepEqual(lint('require("node:path")', file), []));
