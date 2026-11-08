import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { layoutConfigPath, loadLayoutConfig } from "../src/layout-config.mjs";

it("loads the workspace's fixed config independently of process cwd or package.json", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "layout-loader-"));
  assert.notEqual(workspace, process.cwd());
  assert.equal(layoutConfigPath(workspace), path.join(workspace, ".dependency-cruiser.cjs"));
  writeFileSync(
    layoutConfigPath(workspace),
    'module.exports = { forbidden: [], options: { marker: "fixed_marker" } };',
  );
  assert.equal(loadLayoutConfig(workspace).options.marker, "fixed_marker");
});
it("preserves the direct load error for a missing config", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "layout-loader-missing-"));
  assert.throws(() => loadLayoutConfig(workspace), { code: "MODULE_NOT_FOUND" });
});
it("preserves the invalid-config error", () => {
  const invalid = mkdtempSync(path.join(tmpdir(), "layout-loader-invalid-"));
  writeFileSync(layoutConfigPath(invalid), "module.exports = {};");
  assert.throws(() => loadLayoutConfig(invalid), /must export a Dependency Cruiser layout config/);
});
