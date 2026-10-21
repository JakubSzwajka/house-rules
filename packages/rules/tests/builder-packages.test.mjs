import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin, { featuresConfig } from "../src/index.mjs";

const root = mkdtempSync(path.join(tmpdir(), "builder-packages-"));
const files = {
  "packages/bridge/package.json": JSON.stringify({
    name: "@acme/bridge",
    exports: { ".": "./src/index.ts" },
  }),
  "packages/bridge/src/index.ts":
    'export { defineFeature as enter } from "@house-rules/application"; import { defineFeature } from "@house-rules/application/contract"; export const wrap = (n: unknown) => defineFeature(n); export function functionWrap(n: unknown) { return defineFeature(n); } export let mutable = defineFeature; export * as Kit from "@house-rules/application";',
  "packages/bridge/src/barrel.ts": 'export * from "./index.ts";',
  "packages/domain/package.json": '{"name":"@house-rules/domain"}',
  "packages/application/package.json": '{"name":"@house-rules/application"}',
  "apps/api/src/features/show/node.ts":
    'import { defineOperation } from "@house-rules/domain/contract"; export const show = defineOperation("show", {});',
};
for (const [file, content] of Object.entries(files)) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
const lint = (code, file, config = plugin.configs.features) =>
  new Linter({ cwd: root })
    .verify(code, config, { filename: path.join(root, file) })
    .filter((m) => m.ruleId === "house-rules/feature-builders" || m.fatal)
    .map((m) => m.messageId ?? m.message);
for (const [name, door] of [
  ["defineOperation", "@house-rules/domain/contract"],
  ["defineFeature", "@house-rules/application/contract"],
  ["defineWay", "@house-rules/application"],
  ["endpoint", "@house-rules/application/contract"],
]) {
  for (const code of [
    `export { ${name} as builder } from "${door}";`,
    `import { ${name} } from "${door}"; export const alias = ${name};`,
    `import { ${name} } from "${door}"; export const wrap = (n: unknown) => ${name}(n);`,
    `import * as Kit from "${door}"; export const alias = Kit.${name};`,
  ])
    it(`rejects package builder laundering: ${code}`, () => {
      assert.deepEqual(
        lint(code, "packages/bridge/src/builder.ts"),
        name !== "defineOperation" && code.includes("=>") ? ["named", "named"] : ["named"],
      );
    });
}
for (const name of ["enter", "wrap", "functionWrap", "mutable"]) {
  it(`rejects app calling package helper: ${name}`, () => {
    assert.deepEqual(
      lint(
        `import { ${name} } from "@acme/bridge"; export const e = ${name}(unknownNode);`,
        "apps/api/src/composition/entries.ts",
      ),
      ["named"],
    );
  });
}
it("bounds repeated helper paths without losing a reachable builder", { timeout: 10000 }, () => {
  const directory = path.join(root, "packages/diamond");
  mkdirSync(path.join(directory, "src"), { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    '{"name":"@acme/diamond","exports":{".":"./src/index.ts"}}',
  );
  const edges = Array.from(
    { length: 20 },
    (_, i) => `export const f${i + 1} = (n: unknown) => [f${i}(n), f${i}(n)];`,
  ).join("\n");
  for (const [leaf, expected] of [
    ["export const f0 = (n: unknown) => n;", []],
    [
      'import { defineFeature } from "@house-rules/application/contract"; export const f0 = (n: unknown) => defineFeature(n);',
      ["named"],
    ],
  ]) {
    writeFileSync(path.join(directory, "src/index.ts"), `${leaf}\n${edges}`);
    assert.deepEqual(
      lint(
        'import { f20 } from "@acme/diamond"; export const e = f20(unknownNode);',
        "apps/api/src/composition/diamond.ts",
      ),
      expected,
    );
  }
});
it("checks JavaScript package production source too", () => {
  assert.deepEqual(
    lint(
      'export { defineFeature as e } from "@house-rules/application";',
      "packages/bridge/src/index.mjs",
    ),
    ["named"],
  );
});
it("rejects a package namespace re-export at the app member call", () => {
  assert.deepEqual(
    lint(
      'import { Kit } from "@acme/bridge"; export const e = Kit.defineFeature(unknownNode);',
      "apps/api/src/composition/entries.ts",
    ),
    ["named"],
  );
});
it("checks configured package roots rather than only defaults", () => {
  assert.deepEqual(
    lint(
      'export { defineFeature as e } from "@house-rules/application";',
      "examples/shop/libs/bridge/src/index.ts",
      featuresConfig({ packagesDir: ["packages", "examples/*/libs"] }),
    ),
    ["named"],
  );
});
for (const file of [
  "packages/domain/src/index.ts",
  "packages/application/src/index.ts",
  "packages/bridge/src/tests/builder.test.ts",
  "packages/bridge/scripts/builder.ts",
  "scripts/builder.ts",
]) {
  it(`allows kit implementation, tests or top-level tooling: ${file}`, () => {
    assert.deepEqual(
      lint('export { defineFeature as e } from "@house-rules/application";', file),
      [],
    );
  });
}
it("allows direct shared-package node descriptors and unrelated endpoint identities", () => {
  assert.deepEqual(
    lint(
      'import { defineOperation } from "@house-rules/domain/contract"; export const node = defineOperation("node", {});',
      "packages/bridge/src/contract.ts",
    ),
    [],
  );
  for (const file of ["apps/api/src/composition/otel.ts", "packages/bridge/src/telemetry.ts"]) {
    assert.deepEqual(
      lint(
        'import { Config } from "@acme/otel"; export const e = Config.endpoint("TRACES");',
        file,
      ),
      [],
    );
    assert.deepEqual(
      lint(
        'const Config = { endpoint: (s: string) => s }; export const e = Config.endpoint("TRACES");',
        file,
      ),
      [],
    );
  }
});
