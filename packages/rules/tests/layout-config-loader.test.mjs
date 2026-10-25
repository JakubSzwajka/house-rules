import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { layoutConfigPath, loadLayoutConfig, readAppsRoot } from "../src/layout-config.mjs";

it("loads the workspace's fixed config independently of process cwd or package.json", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "layout-loader-"));
  assert.notEqual(workspace, process.cwd());
  assert.equal(layoutConfigPath(workspace), path.join(workspace, ".dependency-cruiser.cjs"));
  writeFileSync(
    layoutConfigPath(workspace),
    'module.exports = { forbidden: [{ name: "packages-do-not-import-apps", to: { path: "^examples/shop/apps/" } }], options: { marker: "fixed_marker" } };',
  );
  assert.equal(loadLayoutConfig(workspace).options.marker, "fixed_marker");
  assert.equal(readAppsRoot(workspace).source, new RegExp("^examples/shop/apps/", "u").source);
});
it("preserves missing-config fallback and direct load error", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "layout-loader-missing-"));
  assert.equal(readAppsRoot(workspace).source, "^apps\\/");
  assert.throws(() => loadLayoutConfig(workspace), { code: "MODULE_NOT_FOUND" });
});
it("preserves invalid-config and missing-app-root errors", () => {
  const invalid = mkdtempSync(path.join(tmpdir(), "layout-loader-invalid-"));
  writeFileSync(layoutConfigPath(invalid), "module.exports = {};");
  assert.throws(() => loadLayoutConfig(invalid), /must export a Dependency Cruiser layout config/);
  const noRoot = mkdtempSync(path.join(tmpdir(), "layout-loader-no-root-"));
  writeFileSync(layoutConfigPath(noRoot), "module.exports = { forbidden: [], options: {} };");
  assert.throws(() => readAppsRoot(noRoot), /has no "packages-do-not-import-apps" rule/);
});
