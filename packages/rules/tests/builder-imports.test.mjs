import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

for (const name of ["defineNode", "defineEntry", "defineWay", "endpoint"]) {
  const door =
    name === "defineNode"
      ? "@house-rules/domain/contract"
      : name === "defineWay"
        ? "@house-rules/application"
        : "@house-rules/application/contract";
  const variants = {
    "namespace static": `import * as App from "${door}"; App.${name}(unknown);`,
    "namespace destructure": `import * as App from "${door}"; const {${name}} = App; ${name}(unknown);`,
    "namespace destructure rename": `import * as App from "${door}"; const {${name}: de} = App; de(unknown);`,
    "member alias": `import * as App from "${door}"; const de = App.${name}; de(unknown);`,
    "namespace alias": `import * as App from "${door}"; const A = App; A.${name}(unknown);`,
    "computed dynamic": `import * as App from "${door}"; const k = "${name}"; App[k](unknown);`,
    "named runtime alias": `import {${name}} from "${door}"; const de = ${name}; de(unknown);`,
    "named callback": `import {${name}} from "${door}"; [unknown].map(${name});`,
    "namespace callback": `import * as App from "${door}"; [unknown].map(App.${name});`,
    "call receiver": `import {${name}} from "${door}"; ${name}.call(null, unknown);`,
    "dynamic import": `const {${name}} = await import("${door}"); ${name}(unknown);`,
    "barrel named": `import {${name}} from "./kit.ts"; ${name}(unknown);`,
    "barrel renamed": `import {forward as build} from "./rename.ts"; build(unknown);`,
    "star barrel": `import {${name}} from "./star.ts"; ${name}(unknown);`,
    "unresolved barrel": `import {${name}} from "./missing.ts"; ${name}(unknown);`,
    "unresolved member": `import {App} from "./missing.ts"; App.${name}(unknown);`,
    "kit namespace reexport": `export * as App from "${door}";`,
    "import equals require": `import App = require("${door}"); App.${name}(unknown);`,
  };
  for (const [label, code] of Object.entries(variants))
    it(`${name} rejects ${label}`, () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "builder-import-"));
      const directory = path.join(root, "apps/api/src/composition");
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, "kit.ts"), `export {${name}} from "${door}";`);
        writeFileSync(
          path.join(directory, "rename.ts"),
          `export {${name} as forward} from "${door}";`,
        );
        writeFileSync(path.join(directory, "star.ts"), `export * from "${door}";`);
        const result = new Linter({ cwd: root }).verify(code, plugin.configs.nodes, {
          filename: path.join(directory, "hook.ts"),
        });
        const reports = result.filter(({ ruleId }) => ruleId === "house-rules/entry-from-app-node");
        assert.deepEqual(
          reports.map(({ messageId }) => messageId),
          label === "namespace alias" ? ["named", "named"] : ["named"],
          JSON.stringify(result),
        );
        assert.match(
          reports[0].message,
          /^Import (defineNode|defineEntry|defineWay|endpoint) by name from @house-rules\//u,
        );
        assert.equal(result.filter(({ fatal }) => fatal).length, 0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
}
