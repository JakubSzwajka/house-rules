import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { parseForESLint } from "@typescript-eslint/parser";
import { sourceGraph } from "../src/source-provenance.mjs";

const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "source-builder-origin-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, source) => fs.writeFileSync(path.join(root, file), source);
  const graph = (source) => {
    const { ast, scopeManager } = parseForESLint(source, { sourceType: "module" });
    const filename = path.join(root, "current.ts");
    return {
      filename,
      node: ast.body.at(-1).expression,
      graph: sourceGraph(filename, ast, scopeManager, { cwd: root }),
    };
  };
  return { put, graph };
};

it("skips aggregate traversal without reachable builder imports and keeps builder modes separate", (t) => {
  const { put, graph } = fixture(t);
  put(
    "leaf.ts",
    'import { defineOperation } from "@house-rules/domain/contract"; export const aggregate = { make: () => defineOperation("x", {}) };',
  );
  const current = graph('import { aggregate } from "./leaf.ts"; aggregate;');
  const root = current.graph.resolve(current.filename, current.node).node;
  const properties = root.properties;
  let visits = 0;
  Object.defineProperty(root, "properties", {
    enumerable: true,
    get() {
      visits++;
      return properties;
    },
  });
  assert.equal(
    current.graph.builderOrigin(current.filename, current.node, {
      imported: "defineFeature",
      completed: true,
    }),
    undefined,
  );
  assert.equal(visits, 0);
  assert.equal(
    current.graph.builderOrigin(current.filename, current.node, {
      imported: "defineOperation",
      completed: true,
    }).imported,
    "defineOperation",
  );
  assert.ok(visits > 0);
  Object.defineProperty(root, "properties", { enumerable: true, value: properties });
});

it("follows renamed, namespace, star and cyclic imports and refreshes new graphs", (t) => {
  const { put, graph } = fixture(t);
  put("one.ts", 'export * from "./two.ts"; export * from "./leaf.ts";');
  put("two.ts", 'export * from "./one.ts";');
  put("leaf.ts", "export const aggregate = { value: 1 };");
  const source = 'import { aggregate } from "./two.ts"; aggregate;';
  const first = graph(source);
  const options = { imported: "defineFeature", completed: true };
  assert.equal(first.graph.builderOrigin(first.filename, first.node, options), undefined);
  for (const declaration of [
    'import { defineFeature as make } from "@house-rules/application/contract"; export const aggregate = { make };',
    'import * as kit from "@house-rules/application/contract"; export const aggregate = { make: kit.defineFeature };',
    'export * from "@house-rules/application/contract"; export const aggregate = 1;',
  ]) {
    put("leaf.ts", declaration);
    const current = graph(
      declaration.startsWith("export *")
        ? 'import * as aggregate from "./two.ts"; aggregate;'
        : source,
    );
    assert.equal(
      current.graph.builderOrigin(current.filename, current.node, options).imported,
      "defineFeature",
    );
  }
});
