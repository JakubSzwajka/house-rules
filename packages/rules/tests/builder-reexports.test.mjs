import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import { featuresConfig } from "../src/index.mjs";

const root = mkdtempSync(path.join(tmpdir(), "builder-reexports-"));
for (const [file, text] of Object.entries({
  "apps/tests/package.json": "{}",
  "packages/tests/package.json": '{"name":"@acme/tests"}',
  "packages/application/package.json": '{"name":"@acme/not-the-kit"}',
  "packages/named/package.json": '{"name":"@acme/named","exports":{".":"./src/index.ts"}}',
  "packages/named/src/index.ts": 'export { defineFeature as mk } from "@house-rules/application";',
  "packages/star/package.json": '{"name":"@acme/star","exports":{".":"./src/index.ts"}}',
  "packages/star/src/index.ts": 'export * from "@house-rules/application";',
  "packages/mixed/package.json": '{"name":"@acme/mixed","exports":{".":"./src/index.ts"}}',
  "packages/mixed/src/index.ts":
    'export { defineFeature } from "@house-rules/application"; export { endpoint } from "@acme/otel";',
  "scripts/named.mjs": 'export { defineFeature as mk } from "@house-rules/application";',
  "scripts/star.mjs": 'export * from "@house-rules/application";',
})) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}
const lint = (code, file) =>
  new Linter({ cwd: root })
    .verify(code, featuresConfig(), { filename: path.join(root, file) })
    .filter((m) => m.ruleId === "house-rules/feature-builders" || m.fatal)
    .map((m) => m.messageId ?? m.message);
for (const source of [
  "@acme/named",
  "@acme/star",
  "../../../../scripts/named.mjs",
  "../../../../scripts/star.mjs",
])
  for (const extension of ["ts", "cjs"])
    it(`recognizes kit reexport identity in ${source} .${extension}`, () => {
      assert.deepEqual(
        lint(
          `const K = require("${source}"); K.mk(node);`,
          `apps/tests/src/composition/main.${extension}`,
        ),
        ["named"],
      );
    });
for (const file of [
  "apps/tests/src/main.ts",
  "packages/tests/src/main.ts",
  "packages/application/src/main.ts",
])
  it(`never exempts production by workspace basename or mismatched kit name: ${file}`, () => {
    assert.deepEqual(lint('export { defineFeature } from "@house-rules/application";', file), [
      "named",
    ]);
  });
for (const code of [
  'export { endpoint } from "@acme/otel";',
  'export { endpoint as other } from "@acme/otel";',
  'export { endpoint as other } from "@acme/mixed";',
  'import { endpoint as local } from "@acme/otel"; export { local as endpoint };',
  "const endpoint = (s) => s; export { endpoint };",
])
  it(`preserves unrelated reexport identity: ${code}`, () =>
    assert.deepEqual(lint(code, "packages/tests/src/main.ts"), []));
