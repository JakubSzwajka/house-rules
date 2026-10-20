import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

it("keeps direct import renames and builder type queries, but requires defineWay's real door", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "builder-positive-"));
  try {
    const folder = path.join(root, "apps/api/src/features/show");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "node.ts"),
      'import {defineNode as node} from "@house-rules/domain/contract"; export const show = node("show", {});',
    );
    const filename = path.join(root, "apps/api/src/composition/entry.ts");
    const lint = (source) =>
      new Linter({ cwd: root }).verify(source, plugin.configs.nodes, { filename });
    assert.deepEqual(
      lint(
        'import {defineEntry as enter, defineWay as way} from "@house-rules/application"; import {endpoint as at} from "@house-rules/application/contract"; import {show} from "../features/show/node.ts"; const entry = enter(show); const endpoint = at(entry); way({entries:[entry]}); export type Builder = typeof enter;',
      ),
      [],
    );
    assert.deepEqual(
      lint(
        'import {defineWay} from "@house-rules/application/contract"; defineWay({entries:[]});',
      ).map(({ ruleId, messageId }) => ({ ruleId, messageId })),
      [{ ruleId: "house-rules/entry-from-app-node", messageId: "named" }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
