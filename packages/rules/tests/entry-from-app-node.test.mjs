import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

it("follows app descriptors and entry barrels for ways, hooks, schedules and endpoints", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "entry-origin-"));
  const files = {
    "features/show/node.ts":
      'import { defineNode } from "@house-rules/domain/contract"; export const show = defineNode("show", {});',
    "features/index.ts": 'export { show as renamed } from "./show/node.ts";',
    "features/show/entry.ts":
      'import {defineEntry as enter} from "@house-rules/application/contract"; import {show as own} from "./node.ts"; export const entry = enter(own);',
    "composition/entries.ts":
      'import { defineEntry } from "@house-rules/application/contract"; import { renamed } from "../features/index.ts"; export const entry = defineEntry(renamed);',
    "composition/index.ts": 'export { entry } from "./entries.ts";',
    "modules/books/contract.ts":
      'import { defineNode } from "@house-rules/domain/contract"; export const show = defineNode("books.show", {});',
    "read-models/books/contract.ts": 'export { show } from "../../modules/books/contract.ts";',
    "composition/local.ts":
      'import { defineNode } from "@house-rules/domain/contract"; export const show = defineNode("local", {});',
  };
  try {
    for (const [file, code] of Object.entries(files)) {
      const target = path.join(root, "apps/api/src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, code);
    }
    const lint = (code, at = "composition/hook.ts") =>
      new Linter({ cwd: root })
        .verify(code, plugin.configs.nodes, { filename: path.join(root, "apps/api/src", at) })
        .filter(({ ruleId }) => ruleId === "house-rules/entry-from-app-node");
    assert.deepEqual(
      lint(
        'import {defineWay} from "@house-rules/application"; import {endpoint} from "@house-rules/application/contract"; import {entry} from "../../features/show/entry.ts"; endpoint(entry); defineWay({entries:[entry]});',
        "ways-in/web/way.ts",
      ),
      [],
    );
    for (const options of [
      "",
      ', {start: {kind:"system", reason:"hook", startedBy:"hook:login"}}',
      ', {start: {kind:"system", reason:"schedule", startedBy:"schedule:night"}}',
    ]) {
      assert.deepEqual(
        lint(
          `import { defineEntry as enter } from "@house-rules/application"; import { renamed } from "../features/index.ts"; export const x = enter(renamed${options});`,
        ),
        [],
      );
    }
    for (const start of [
      "",
      ', {start:{kind:"system",reason:"new login",startedBy:"hook:new-login"}}',
      ', {start:{kind:"system",reason:"nightly cleanup",startedBy:"schedule:nightly_cleanup"}}',
    ])
      assert.deepEqual(
        lint(
          `import {defineEntry as enter} from "@house-rules/application/contract"; import {show as own} from "./node.ts"; export const entry = enter(own${start}); export type X = string;`,
          "features/show/entry.ts",
        ),
        [],
      );
    assert.deepEqual(
      lint(
        'import { defineWay } from "@house-rules/application"; import { endpoint } from "@house-rules/application/contract"; import { entry } from "../../composition/index.ts"; const endpoints = [endpoint(entry)]; const way = defineWay({entries:[entry]});',
        "ways-in/web/way.ts",
      ),
      [],
    );
    for (const origin of [
      "../modules/books/contract.ts",
      "../read-models/books/contract.ts",
      "./local.ts",
      "@vendor/books/contract",
      "../features/missing/node.ts",
    ]) {
      assert.ok(
        lint(
          `import { defineEntry } from "@house-rules/application"; import { show } from "${origin}"; const x = defineEntry(show);`,
        ).length,
        origin,
      );
    }
    assert.ok(
      lint(
        'import { defineWay } from "@house-rules/application"; import { entry } from "@vendor/entries"; defineWay({entries:[entry]});',
      ).length,
    );
    assert.deepEqual(
      lint(
        'import { defineEntry } from "@house-rules/application"; import { renamed } from "../features/index.ts"; const alias = renamed; defineEntry(alias);',
      ),
      [],
    );
    for (const code of [
      'import { defineEntry } from "@house-rules/application"; import { renamed } from "../features/index.ts"; function hook(renamed: unknown) { return defineEntry(renamed); }',
      'import { defineWay } from "@house-rules/application"; import { entry } from "./index.ts"; function open(entry: unknown) { return defineWay({entries:[entry]}); }',
    ])
      assert.ok(lint(code).length, code);
    for (const kind of ["let", "var"]) {
      assert.deepEqual(
        lint(
          `import {defineEntry} from "@house-rules/application"; import {renamed} from "../features/index.ts"; ${kind} selected = renamed; selected = unknownNode; defineEntry(selected);`,
        ).map(({ messageId }) => messageId),
        ["origin"],
      );
    }
    writeFileSync(
      path.join(root, "apps/api/src/composition/mutable.ts"),
      'import {defineEntry} from "@house-rules/application"; import {renamed} from "../features/index.ts"; export let entry = defineEntry(renamed);',
    );
    assert.deepEqual(
      lint(
        'import {endpoint} from "@house-rules/application/contract"; import {entry} from "./mutable.ts"; endpoint(entry);',
      ).map(({ messageId }) => messageId),
      ["origin"],
    );
    files["composition/shadowed.ts"] =
      'import { defineEntry } from "@house-rules/application"; import { renamed } from "../features/index.ts"; export const entry = (() => { const renamed = unknownNode; return defineEntry(renamed); })();';
    writeFileSync(
      path.join(root, "apps/api/src/composition/shadowed.ts"),
      files["composition/shadowed.ts"],
    );
    assert.ok(
      lint(
        'import { endpoint } from "@house-rules/application/contract"; import { entry } from "./shadowed.ts"; endpoint(entry);',
      ).length,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
