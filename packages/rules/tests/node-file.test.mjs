import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const prelude =
  'import { defineNode as node } from "@house-rules/domain/contract"; import { Schema } from "effect";';
const value =
  'node("show", { input: Schema.Struct({id: Schema.String}), output: Schema.String, failure: Schema.Union([Schema.Never]), edges: [], permission: null })';
const lint = (code, filename = "apps/api/src/features/show/node.ts") =>
  new Linter()
    .verify(code, plugin.configs.nodes, { filename })
    .filter(({ ruleId }) => ruleId === "house-rules/node-file");
it("accepts a direct aliased descriptor with Struct/Union and type exports", () => {
  assert.deepEqual(lint(`${prelude} export const show = ${value}; export type X = string;`), []);
});
it("rejects two descriptors, extra values, wrappers, fake imports, reexports and handler imports", () => {
  for (const code of [
    `${prelude} export const a = ${value}, b = ${value};`,
    `${prelude} export const a = ${value}; export const b = 1;`,
    `${prelude} export const a = wrap(${value});`,
    `const defineNode = () => ({}); export const a = defineNode();`,
    'export { show } from "../other/node.ts";',
    `${prelude} import { handler } from "./handler.ts"; export const a = ${value};`,
  ])
    assert.ok(lint(code).length, code);
});
it("checks optional entries by own-node import identity, including both system starts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "entry-file-"));
  const dir = path.join(root, "apps/api/src/features/show");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "node.ts"), `${prelude} export const show = ${value};`);
  const run = (code) =>
    new Linter({ cwd: root })
      .verify(code, plugin.configs.nodes, {
        filename: path.join(dir, "entry.ts"),
      })
      .filter(({ ruleId }) => ruleId === "house-rules/node-file");
  const imports =
    'import {defineEntry as enter} from "@house-rules/application/contract"; import {show as own} from "./node.ts";';
  try {
    for (const start of [
      "",
      ', {start:{kind:"system", reason:"new login", startedBy:"hook:new-login"}}',
      ', {start:{kind:"system", reason:"nightly cleanup", startedBy:"schedule:nightly_cleanup"}}',
    ])
      assert.deepEqual(
        run(`${imports} export const entry = enter(own${start}); export type X = string;`),
        [],
      );
    for (const code of [
      `${imports} const entry = enter(own);`,
      `${imports} export const a = enter(own), b = enter(own);`,
      `${imports} const x = enter(own); export {x};`,
      `${imports} export let x = enter(own);`,
      `${imports} const alias = enter; export const x = alias(own);`,
      `${imports} const alias = own; export const x = enter(alias);`,
      `${imports} function make(own) { return enter(own); } export const x = make(own);`,
      'import {defineEntry as enter} from "@house-rules/application/contract"; import {show as own} from "../other/node.ts"; export const x = enter(own);',
      `${imports} export const x = (() => {const own = foreign; return enter(own);})();`,
      'import * as kit from "@house-rules/application/contract"; import {show} from "./node.ts"; export const x = kit.defineEntry(show);',
      'import * as own from "./node.ts"; import {defineEntry} from "@house-rules/application/contract"; export const x = defineEntry(own);',
      'import {defineEntry} from "@house-rules/application"; import {show} from "./node.ts"; export const x = defineEntry(show);',
      'import {defineEntry} from "./barrel.ts"; import {show} from "./node.ts"; export const x = defineEntry(show);',
      ...[
        "../other/node.ts",
        "./handler.ts",
        "../../composition/index.ts",
        "../other/entry.ts",
      ].flatMap((source) => [
        `${imports} import {show} from "${source}"; export const x = enter(show);`,
        `${imports} import type {X} from "${source}"; export const x = enter(own);`,
      ]),
    ])
      assert.ok(run(code).length, code);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("exempts tests", () =>
  assert.deepEqual(
    lint("export const anything = 1;", "apps/api/src/features/show/tests/show.test.ts"),
    [],
  ));
it("requires a direct binding of the own node", () => {
  const cwd = process.cwd();
  const root = mkdtempSync(path.join(os.tmpdir(), "node-file-"));
  try {
    const dir = path.join(root, "apps/api/src/features/show");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "node.ts"), `${prelude} export const show = ${value};`);
    const filename = path.join(dir, "handler.ts");
    const config = plugin.configs.nodes;
    const run = (source) =>
      new Linter({ cwd: root })
        .verify(source, config, { filename })
        .filter(({ ruleId }) => ruleId === "house-rules/node-file");
    assert.deepEqual(
      run(
        'import { bindNode as bind } from "@house-rules/application"; import { show } from "./node.ts"; export const handler = bind(show, () => work);',
      ),
      [],
    );
    assert.ok(
      run(
        'import { bindNode } from "@house-rules/application"; import { show } from "../other/node.ts"; export const handler = bindNode(show, () => work);',
      ).length,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    assert.equal(process.cwd(), cwd);
  }
});
