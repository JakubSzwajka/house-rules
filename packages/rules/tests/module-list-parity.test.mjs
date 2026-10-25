import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { run } from "./migrations-helpers.mjs";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/migrations/module-list-parity.json", import.meta.url), "utf8"),
);
for (const item of cases)
  it(`shared location parity: ${item.label}`, () => {
    const result = run(item.files, { cwd: item.cwd ?? ".", links: item.links ?? {} });
    assert.equal(result.status, item.accepts ? 0 : 1, result.stderr);
    if (!item.accepts) {
      assert.ok(item.checkerReason, `missing checker reason: ${item.label}`);
      assert.match(
        result.stderr,
        new RegExp(item.checkerReason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")),
        item.label,
      );
      if (item.kind === "folder")
        assert.doesNotMatch(result.stderr, /module list does not name it/, item.label);
    }
  });
