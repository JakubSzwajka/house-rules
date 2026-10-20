import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin, { nodesConfig } from "../src/index.mjs";

// A checkout ancestor named tests must not grant production an exemption.
const parent = path.join(tmpdir(), "tests");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(path.join(parent, "builder-boundaries-"));
const files = {
  "packages/bridge/package.json": '{"name":"@acme/bridge","exports":{".":"./src/index.ts"}}',
  "packages/bridge/src/index.ts": 'export * from "./sub/wrap.ts";',
  "packages/bridge/src/sub/package.json": '{"name":"@house-rules/application"}',
  "packages/bridge/src/sub/wrap.ts":
    'import { defineEntry } from "@house-rules/application"; export const wrap = (n: unknown) => defineEntry(n);',
  "packages/default/package.json": '{"name":"@acme/default","exports":{".":"./src/index.ts"}}',
  "packages/default/src/index.ts":
    'import { defineEntry } from "@house-rules/application"; export default { wrap: (n: unknown) => defineEntry(n) };',
  "packages/plain/package.json": '{"name":"@acme/plain","exports":{".":"./src/index.ts"}}',
  "packages/plain/src/index.ts": "export const endpoint = (n: unknown) => n;",
  "packages/application/package.json": '{"name":"@house-rules/application"}',
  "packages/application/src/index.ts": 'export { defineEntry } from "./entry.ts";',
  "packages/domain/package.json": '{"name":"@house-rules/domain"}',
  "packages/domain/src/index.ts": 'export { defineNode } from "./node.ts";',
};
for (const [file, text] of Object.entries(files)) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
const configs = [
  plugin.configs.nodes,
  [...plugin.configs.recommended, ...nodesConfig({ appsDir: ["apps"], packagesDir: ["packages"] })],
];
const lint = (code, file, config) =>
  new Linter({ cwd: root })
    .verify(code, config, { filename: path.join(root, file) })
    .filter((m) => m.ruleId === "house-rules/entry-from-app-node" || m.fatal)
    .map((m) => m.messageId ?? m.message);
for (const [index, config] of configs.entries()) {
  for (const extension of ["cjs", "ts"]) {
    for (const code of [
      'const { defineEntry } = require("@house-rules/application"); defineEntry(moduleNode);',
      'const Kit = require("@house-rules/domain/contract"); Kit.defineNode("x", {});',
      'const K = require("@acme/bridge"); K.wrap(moduleNode);',
      'const K = require("../../../../packages/bridge/src/index.ts"); K.wrap(moduleNode);',
      "const K = require(dynamicSpecifier); K.wrap(moduleNode);",
      'import { createRequire as make } from "node:module"; const load = make(import.meta.url); const K = load("@house-rules/application"); K.defineEntry(moduleNode);',
      'import * as M from "node:module"; const load = M.createRequire(import.meta.url); load(dynamicSpecifier);',
      'import { createRequire } from "module"; createRequire(import.meta.url)("@acme/bridge").wrap(moduleNode);',
    ]) {
      it(`rejects loader identity in preset ${index} .${extension}: ${code}`, () => {
        assert.deepEqual(lint(code, `apps/api/src/composition/hook.${extension}`, config), [
          "named",
        ]);
      });
    }
    it(`rejects CommonJS package export in preset ${index} .${extension}`, () => {
      assert.deepEqual(
        lint(
          'const { defineEntry } = require("@house-rules/application"); module.exports = { defineEntry };',
          `packages/bridge/src/export.${extension}`,
          config,
        ),
        ["named"],
      );
    });
  }
  for (const code of [
    'import * as K from "@acme/bridge"; K.wrap(moduleNode);',
    'import K = require("@acme/bridge"); K.wrap(moduleNode);',
    'import K from "@acme/bridge"; K.wrap(moduleNode);',
    'import K from "@acme/default"; K.wrap(moduleNode);',
    'import * as K from "@acme/bridge"; K[dynamicMember](moduleNode);',
  ]) {
    it(`rejects member helper laundering in preset ${index}: ${code}`, () => {
      assert.deepEqual(lint(code, "apps/api/src/composition/hook.ts", config), ["named"]);
    });
  }
  for (const code of [
    'import { endpoint } from "@acme/otel"; endpoint("x");',
    'import { endpoint as otelEndpoint } from "@acme/otel"; otelEndpoint("x");',
    'import { defineEntry as unrelated } from "@acme/otel"; unrelated("x");',
    'import { endpoint } from "@acme/plain"; endpoint("x");',
    'const { endpoint } = require("@acme/otel"); endpoint("x");',
    "function f(require: (n: unknown) => unknown) { return require(dynamicSpecifier); }",
    "const createRequire = () => (n: unknown) => n; const load = createRequire(); load(dynamicSpecifier);",
  ]) {
    it(`allows unrelated import identity in preset ${index}: ${code}`, () => {
      assert.deepEqual(lint(code, "apps/api/src/composition/otel.ts", config), []);
    });
  }
  it(`anchors exemptions to the configured real kit root in preset ${index}`, () => {
    assert.deepEqual(
      lint(files["packages/bridge/src/sub/wrap.ts"], "packages/bridge/src/sub/wrap.ts", config),
      ["named", "named"],
    );
    for (const kit of ["application", "domain"]) {
      assert.deepEqual(
        lint(files[`packages/${kit}/src/index.ts`], `packages/${kit}/src/index.ts`, config),
        [],
      );
    }
    assert.deepEqual(
      lint(
        'export { defineEntry } from "@house-rules/application";',
        "packages/bridge/src/tests/wrap.test.ts",
        config,
      ),
      [],
    );
    assert.deepEqual(
      lint(
        'import { defineEntry } from "@house-rules/application"; defineEntry(moduleNode);',
        "apps/api/src/composition/hook.ts",
        config,
      ),
      ["origin"],
    );
  });
}
