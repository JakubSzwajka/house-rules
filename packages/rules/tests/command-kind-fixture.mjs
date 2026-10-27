import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import houseRules from "@house-rules/rules";

export const root = mkdtempSync(path.join(tmpdir(), "command-kind-"));
const put = (file, code) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, code);
};
put("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "examples/*/modules/*"\n');
put("packages/application/package.json", '{"name":"@house-rules/application"}');
put("packages/domain/package.json", '{"name":"@house-rules/domain"}');
put("examples/kits/modules/application/package.json", '{"name":"@house-rules/application"}');
put("examples/foreign/modules/application/package.json", '{"name":"@foreign/application"}');
put("packages/foreign/package.json", '{"name":"@foreign/application"}');
put(
  "apps/api/src/builders.ts",
  'export { defineFeature as make } from "@house-rules/application/contract";',
);
put("packages/bridge/package.json", '{"name":"@test/bridge","exports":{".":"./src/index.ts"}}');
put("packages/bridge/src/index.ts", 'export * from "@house-rules/application/contract";');
put("apps/api/src/nested/package.json", '{"name":"@house-rules/application"}');
put(
  "examples/demo/modules/bridge/package.json",
  '{"name":"@custom/bridge","exports": {".": "./src/index.ts"}}',
);
put(
  "examples/demo/modules/bridge/src/index.ts",
  'export { defineFeature as make } from "@house-rules/application/contract";',
);
for (const file of [
  "apps/api/src/test/make.ts",
  "apps/api/src/tests/make.ts",
  "apps/api/scripts/make.ts",
])
  put(
    file,
    'import { defineFeature } from "@house-rules/application/contract"; export const make = (name, options) => defineFeature(name, options);',
  );
export const commandPath = "apps/api/src/features/probe/index.ts";
export const queryPath = "apps/api/src/read-models/probe/index.ts";
export const source = (flags = "", builder = "defineFeature") => `
import { ${builder} as build } from "@house-rules/application/contract";
export const probe = build("arbitrary_name", { edges: [], ${flags} handler: () => null });`;
export const lint = async (code, file = commandPath, full = false, cwd = root) => {
  mkdirSync(cwd, { recursive: true });
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      ...houseRules.configs.recommended,
      ...(full ? houseRules.configs.features : []),
    ],
  });
  return (await eslint.lintText(code, { filePath: path.join(root, file) }))[0].messages;
};
export const rejects = async (code, file) => {
  const messages = await lint(code, file);
  assert.ok(messages.length, code);
  assert.ok(
    messages.every(
      ({ ruleId, severity }) => ruleId === "house-rules/command-kind" && severity === 2,
    ),
    JSON.stringify(messages),
  );
};
