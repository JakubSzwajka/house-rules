import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin, { featuresConfig } from "../src/index.mjs";

const prelude =
  'import { defineFeature as feature } from "@house-rules/application/contract"; import { Schema } from "effect";';
const value =
  'feature("show", { input: Schema.String, output: Schema.String, failure: Schema.Never, permission: null, edges: [], handler: (_, {call}) => call(show) })';
const lint = (
  code,
  filename = "apps/api/src/features/show/index.ts",
  config = plugin.configs.features,
) =>
  new Linter()
    .verify(code, config, { filename })
    .filter(({ ruleId }) => ruleId === "house-rules/feature-file");
it("accepts a one-file feature, named import rename and type exports", () => {
  assert.deepEqual(
    lint(`${prelude} export const show = ${value}; export type X = string; export interface Y {}`),
    [],
  );
});
it("accepts a system-start feature", () => {
  assert.deepEqual(
    lint(
      `${prelude} import {systemStart} from "@house-rules/application/contract"; export const show = feature("show", {start: systemStart("nightly cleanup", "schedule:night"), handler: () => Effect.void});`,
    ),
    [],
  );
});
it("rejects two exports, wrappers, fake builders, export aliases and re-exports", () => {
  for (const code of [
    `${prelude} export const a = ${value}, b = ${value};`,
    `${prelude} export const a = ${value}; export const b = 1;`,
    `${prelude} export const a = wrap(${value});`,
    `const defineFeature = () => ({}); export const a = defineFeature();`,
    'export { show } from "../other/index.ts";',
    `${prelude} const show = ${value}; export {show};`,
    `${prelude} export let show = ${value};`,
    `${prelude} export const {a,b} = ${value};`,
    `${prelude} export const [a,b] = ${value};`,
    `${prelude} const alias = feature; export const show = alias("show", {});`,
    'import * as kit from "@house-rules/application/contract"; export const show = kit.defineFeature("show", {});',
    'import {defineFeature} from "@house-rules/application"; export const show = defineFeature("show", {});',
  ])
    assert.ok(lint(code).length, code);
});
it("counts unexported and nested builder calls as well as exported ones", () => {
  for (const extra of [
    `const hidden = ${value};`,
    `const hidden = () => ${value};`,
    `export const hidden = ${value};`,
  ])
    assert.ok(
      lint(`${prelude} ${extra} export const show = ${value};`).some(
        (m) => m.messageId === "shape",
      ),
      extra,
    );
});
it("enforces the import allow-list on values and types", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "feature-imports-"));
  const files = [
    "features/other/index.ts",
    "read-models/books/contract.ts",
    "read-models/books/index.ts",
  ];
  try {
    for (const file of files) {
      const target = path.join(root, "apps/api/src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "export const value = 1;");
    }
    const run = (source) =>
      new Linter({ cwd: root })
        .verify(source, plugin.configs.features, {
          filename: path.join(root, "apps/api/src/features/show/index.ts"),
        })
        .filter((m) => m.ruleId === "house-rules/feature-file");
    for (const source of [
      "effect",
      "@house-rules/domain/contract",
      "@house-rules/application/contract",
      "@acme/books/contract",
      "@acme/book.parts/contract",
      "../other/index.ts",
      "../../read-models/books/contract.ts",
    ])
      for (const modifier of ["", "type "])
        assert.deepEqual(
          run(
            `${prelude} import ${modifier}{value} from "${source}"; export const show = ${value};`,
          ),
          [],
          source,
        );
    for (const source of [
      "@acme/books",
      "@house-rules/domain",
      "@house-rules/application",
      "../../read-models/books/index.ts",
      "../../composition/index.ts",
      "./handler.ts",
      "node:fs",
    ])
      for (const modifier of ["", "type "])
        assert.ok(
          run(
            `${prelude} import ${modifier}{value} from "${source}"; export const show = ${value};`,
          ).length,
          source,
        );
    for (const source of [
      "@acme/books",
      "@acme/books/internal/contract",
      "../../composition/index.ts",
    ])
      assert.ok(
        run(`${prelude} export const show = ${value}; const lazy = () => import("${source}");`)
          .length,
        source,
      );
    assert.ok(
      run(`${prelude} export const show = ${value}; export type {X} from "@acme/books";`).length,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("rejects extra files and folders, including files ESLint does not parse", () => {
  for (const extra of ["handler.ts", "notes.md", "nested/file.ts"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "feature-folder-"));
    try {
      const folder = path.join(root, "apps/api/src/features/show");
      mkdirSync(path.join(folder, "tests"), { recursive: true });
      const filename = path.join(folder, "index.ts");
      writeFileSync(filename, `${prelude} export const show = ${value};`);
      const linter = new Linter({ cwd: root });
      assert.deepEqual(
        linter.verify(`${prelude} export const show = ${value};`, plugin.configs.features, {
          filename,
        }),
        [],
      );
      mkdirSync(path.dirname(path.join(folder, extra)), { recursive: true });
      writeFileSync(path.join(folder, extra), "");
      assert.ok(
        linter
          .verify(`${prelude} export const show = ${value};`, plugin.configs.features, { filename })
          .some((m) => m.messageId === "folder"),
        extra,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
it("accepts a registry containing only features and rejects stray values and permission arrays", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "feature-registry-"));
  try {
    const folder = path.join(root, "apps/api/src/features/show");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.ts"), `${prelude} export const show = ${value};`);
    const run = (code) =>
      new Linter({ cwd: root }).verify(code, plugin.configs.features, {
        filename: path.join(root, "apps/api/src/features/index.ts"),
      });
    for (const code of [
      'export {show} from "./show/index.ts";',
      'import {show} from "./show/index.ts"; export const Features = {show} as const; export type X = string;',
      'import {show} from "./show/index.ts"; export {show}; export type {X} from "./show/index.ts";',
      'export * as Features from "./show/index.ts";',
    ])
      assert.deepEqual(run(code), [], code);
    for (const code of [
      "export const stray = 1;",
      "const stray = 1;",
      'export {show} from "./show/index.ts"; export const member = ["x:y"] as const;',
      'import {show} from "./show/index.ts"; export const Features = {show} as const; export const system = [] as const; export type X = string;',
      'const member = ["x:y"] as const;',
      "const system = [] as const;",
      'export const member = ["book:read"];',
      'export const member = ["not-a-permission"] as const;',
      "export const member = [permission] as const;",
      "export const Features = {stray: 1};",
      "export default {};",
      "run();",
      'export {value} from "../composition/index.ts";',
    ])
      assert.ok(
        run(code).some((m) => m.ruleId === "house-rules/feature-file"),
        code,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("exempts feature tests but checks configured alternate app roots", () => {
  assert.deepEqual(
    lint("export const anything = 1;", "apps/api/src/features/show/tests/show.test.ts"),
    [],
  );
  assert.ok(
    lint(
      "export const bad = 1;",
      "examples/shop/apps/api/src/features/show/index.ts",
      featuresConfig({ appsDir: ["apps", "examples/*/apps"] }),
    ).length,
  );
});
it("provides no old presets or rule aliases", () => {
  assert.equal(plugin.configs.nodes, undefined);
  assert.equal(plugin.rules["node-file"], undefined);
  assert.equal(plugin.rules["entry-from-app-node"], undefined);
});
