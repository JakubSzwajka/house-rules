import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const root = mkdtempSync(path.join(tmpdir(), "read-entry-"));
const put = (file, source) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
};
put(
  "packages/store/package.json",
  '{"name":"@test/store","exports":{"./contract":"./src/contract.ts"}}',
);
put(
  "packages/store/src/contract.ts",
  `import { defineOperation, asSystem } from "@house-rules/domain/contract";
export const read = defineOperation("read", { readOnly: true });
export const write = defineOperation("write", {});
export const process = defineOperation("process", { readOnly: true, edges: [asSystem(write, "probe")] });`,
);
const lint = (code, file = "apps/api/src/read-models/list/index.ts") =>
  new Linter({ cwd: root })
    .verify(code, plugin.configs.features, { filename: path.join(root, file) })
    .filter((message) => message.ruleId?.startsWith("house-rules/feature-") || message.fatal);
const prelude =
  'import { defineReadModel } from "@house-rules/application/contract"; import {read, write, process} from "@test/store/contract";';
const query = (edges) =>
  `${prelude} export const list = defineReadModel("list", { edges: ${edges}, handler: () => Effect.void });`;

it("accepts a read model and rejects write, transitive, dynamic and unknown edges", () => {
  assert.deepEqual(lint(query("[read]")), []);
  for (const edges of [
    "[write]",
    "[process]",
    "[unknown]",
    "[...reads]",
    "edges()",
    "[choose ? read : write]",
  ]) {
    const findings = lint(query(edges));
    assert.ok(findings.length, edges);
    assert.ok(
      findings.some(({ message }) => message.includes("Read-model edges must resolve")),
      edges,
    );
    assert.ok(
      findings.every(({ message }) => !message.includes("Pass builder options inline")),
      edges,
    );
  }
});
it("rejects wrong kind, placement, services, adapters, entry imports and indirect builders", () => {
  for (const [code, file] of [
    [query("[read]"), "apps/api/src/features/list/index.ts"],
    [query("[read]"), "apps/api/src/composition/list.ts"],
    [
      query("[read]").replaceAll("defineReadModel", "defineFeature"),
      "apps/api/src/read-models/list/index.ts",
    ],
    [
      `${prelude} const builder = defineReadModel; export const list = builder("list", {});`,
      undefined,
    ],
    [
      `import * as kit from "@house-rules/application/contract"; export const list = kit.defineReadModel("list", {});`,
      undefined,
    ],
  ])
    assert.ok(lint(code, file).length, code);
  for (const source of [
    "@test/store",
    "effect/sql",
    "node:fs",
    "../../features/save/index.ts",
    "../other/index.ts",
    "./adapters/db.ts",
  ])
    assert.ok(lint(`${query("[read]")} import {value} from "${source}";`).length, source);
  assert.ok(lint(query("[read]").replace("{ edges:", "{ ...options, edges:")).length);
  assert.ok(lint(`${query("[read]")} import("@test/store/contract");`).length);
});
it("accepts direct query exposure and rejects unknown and raw operation exposure", () => {
  put("apps/api/src/read-models/list/index.ts", query("[read]"));
  for (const exposed of ["list", "read", "unknown", "select()"]) {
    const code = `import { endpoint } from "@house-rules/application/contract";
      import {list} from "../../read-models/list/index.ts"; import {read} from "@test/store/contract";
      export const route = endpoint(${exposed});`;
    assert.equal(
      lint(code, "apps/api/src/ways-in/web/endpoints.ts").length === 0,
      exposed === "list",
      exposed,
    );
  }
});
