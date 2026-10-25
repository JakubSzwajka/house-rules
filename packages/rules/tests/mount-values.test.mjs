import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const root = mkdtempSync(path.join(tmpdir(), "mount-values-"));
const directory = path.join(root, "packages/items/src");
mkdirSync(directory, { recursive: true });
writeFileSync(
  path.join(directory, "../package.json"),
  JSON.stringify({ name: "@acme/items", exports: { ".": "./src/index.ts" } }),
);
const source = `import { bindOperation } from "@house-rules/application";
const bindItems = (service) => [bindOperation(operation, () => service.read())];
export const ItemsMount = { service: Items, operations: [operation], bind: bindItems };
export { ItemsMount as Mount };
`;
writeFileSync(path.join(directory, "index.ts"), source);
const lint = (code, file) =>
  new Linter({ cwd: root })
    .verify(code, plugin.configs.features, { filename: path.join(root, file) })
    .filter((message) => message.ruleId === "house-rules/feature-builders" || message.fatal);
it("accepts plain package mounts and their re-export as finished values", () => {
  assert.deepEqual(lint(source, "packages/items/src/index.ts"), []);
  assert.deepEqual(
    lint(
      'import { Mount } from "@acme/items"; export const mounts = [{ ...Mount, layer }];',
      "apps/api/src/composition/modules.ts",
    ),
    [],
  );
});
it("accepts the CommentsMount public door and its module-plan entry", () => {
  const comments = readFileSync(new URL("../../comments/src/index.ts", import.meta.url), "utf8");
  assert.deepEqual(lint(comments, "packages/comments/src/index.ts"), []);
  assert.deepEqual(
    lint(
      'import { CommentsMount } from "@house-rules/comments"; export const mounts = [{ ...CommentsMount, layer }];',
      "apps/api/src/composition/modules.ts",
    ),
    [],
  );
});
it("does not permit hiding a kit builder in a mount field", () => {
  const errors = lint(
    'import { bindOperation } from "@house-rules/application"; export const ItemsMount = { service: Items, operations: [], bind: bindOperation };',
    "packages/items/src/index.ts",
  );
  assert.ok(errors.some((error) => error.messageId === "named"));
});
