import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { Linter } from "eslint";
import parser from "@typescript-eslint/parser";
import { sourceGraph } from "../src/source-provenance.mjs";
import { commandKindRule } from "../src/command-kind.mjs";
import { featureBuildersRule } from "../src/feature-builders.mjs";
import { esmOnlyEffectRule } from "../src/esm-only-effect.mjs";

const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "source-graph-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return target;
  };
  put("apps/api/package.json", '{"name":"api"}');
  const leaf = put(
    "apps/api/src/leaf.ts",
    'export { defineFeature as make } from "@house-rules/application/contract"; export const value = 1;',
  );
  const barrel = put("apps/api/src/barrel.ts", 'export { make, value } from "./leaf.ts";');
  const values = [];
  const probe = {
    create(context) {
      return {
        Program(program) {
          const graph = sourceGraph(context.filename, program, context.sourceCode.scopeManager);
          const node = program.body.at(-1).expression;
          values.push(graph.resolve(context.filename, node));
        },
      };
    },
  };
  const linter = new Linter({ cwd: root });
  const lint = (code, file = "one.ts") =>
    linter.verify(
      code,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser },
          plugins: {
            test: {
              rules: {
                probe,
                command: commandKindRule,
                builders: featureBuildersRule,
                esm: esmOnlyEffectRule,
              },
            },
          },
          rules: {
            "test/probe": "error",
            "test/command": "error",
            "test/builders": "error",
            "test/esm": "error",
          },
        },
      ],
      { filename: path.join(root, "apps/api/src", file) },
    );
  return { root, put, leaf, barrel, lint, values };
};

it("parses each dependency once across linted files and all graph consumers", (t) => {
  const { leaf, barrel, lint, values } = fixture(t);
  const reads = new Map();
  const original = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if ([leaf, barrel].includes(file)) reads.set(file, (reads.get(file) ?? 0) + 1);
    return original(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const code = 'import { make, value } from "./barrel.ts"; make("x", {}); value;';
  const first = lint(code);
  assert.ok(first.some(({ ruleId }) => ruleId === "test/command"));
  assert.deepEqual(lint(code, "two.ts"), first);
  assert.deepEqual([...reads.values()], [1, 1]);
  assert.equal(values[0].node, values[1].node);
});

it("invalidates changed, deleted, recreated and previously invalid dependency files", (t) => {
  const { put, leaf, lint, values } = fixture(t);
  const code = 'import { value } from "./leaf.ts"; value;';
  assert.deepEqual(lint(code), []);
  assert.equal(values.at(-1).node.value, 1);
  put("apps/api/src/leaf.ts", "export const value = 222;");
  assert.deepEqual(lint(code, "two.ts"), []);
  assert.equal(values.at(-1).node.value, 222);
  fs.rmSync(leaf);
  assert.deepEqual(lint(code), []);
  assert.equal(values.at(-1)?.node, undefined);
  put("apps/api/src/leaf.ts", "export const value = ;");
  assert.deepEqual(lint(code), []);
  assert.equal(values.at(-1)?.node, undefined);
  put("apps/api/src/leaf.ts", "export const value = 333;");
  assert.deepEqual(lint(code), []);
  assert.equal(values.at(-1).node.value, 333);
});

it("refreshes same-size timestamp edits and size edits with preserved mtime", (t) => {
  const { put, leaf, lint, values } = fixture(t);
  const code = 'import { value } from "./leaf.ts"; value;';
  put("apps/api/src/leaf.ts", "export const value = 11;");
  lint(code);
  const original = fs.statSync(leaf);
  put("apps/api/src/leaf.ts", "export const value = 22;");
  const changed = new Date(original.mtimeMs + 2000);
  fs.utimesSync(leaf, changed, changed);
  lint(code);
  assert.equal(values.at(-1).node.value, 22);
  put("apps/api/src/leaf.ts", "export const value = 3333;");
  fs.utimesSync(leaf, changed, changed);
  lint(code);
  assert.equal(values.at(-1).node.value, 3333);
});

it("uses ESLint's current buffer and scopes without publishing it as disk source", (t) => {
  const { put, leaf, lint, values } = fixture(t);
  const imported = 'import { value } from "./leaf.ts"; value;';
  lint(imported);
  const diskNode = values.at(-1).node;
  assert.deepEqual(lint("const value = 77; value;", "leaf.ts"), []);
  assert.equal(values.at(-1).node.value, 77);
  lint(imported);
  assert.equal(values.at(-1).node, diskNode);
  put("apps/api/src/leaf.ts", "export const value = 8;");
  lint("const value = 99; value;", "leaf.ts");
  assert.equal(values.at(-1).node.value, 99);
  lint(imported);
  assert.equal(values.at(-1).file, leaf);
  assert.equal(values.at(-1).node.value, 8);
});
