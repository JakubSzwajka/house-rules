import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { sourcePackages } from "../src/source-packages.mjs";
import { workspaceDirectories } from "../src/workspaces.mjs";
import { kitImplementation } from "../src/kit-builder-source.mjs";

it("shares manifest reads and directory scans while detecting workspace and kit changes", (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "source-metadata-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return target;
  };
  put("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "examples/*/modules/*"\n');
  const manifest = put("packages/bridge/package.json", '{"name":"bridge"}');
  const kit = put("packages/domain/package.json", '{"name":"@house-rules/domain"}');
  const filename = put("packages/domain/src/index.ts", "");
  const originalRead = fs.readFileSync;
  const originalGlob = fs.globSync;
  const reads = [];
  let scans = 0;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    reads.push(file);
    return originalRead(file, ...args);
  });
  t.mock.method(fs, "globSync", (...args) => {
    scans++;
    return originalGlob(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const sources = (roots = ["packages"]) => sourcePackages(root, roots, workspaceDirectories(root));
  assert.ok(sources().has("bridge"));
  assert.equal(kitImplementation(filename, root, ["packages"]), true);
  const initialScans = scans;
  for (let i = 0; i < 3; i++) {
    assert.ok(sources().has("bridge"));
    assert.equal(kitImplementation(filename, root, ["packages"]), true);
  }
  assert.equal(scans, initialScans);
  assert.equal(reads.filter((file) => file === manifest).length, 1);
  assert.equal(reads.filter((file) => file === kit).length, 1);
  put("packages/bridge/package.json", '{"name":"renamed","exports":{".":"./src/other.ts"}}');
  assert.equal(sources().has("bridge"), false);
  assert.equal(sources().get("renamed"), path.join(root, "packages/bridge/src/other.ts"));
  put("packages/domain/package.json", '{"name":"foreign"}');
  assert.equal(kitImplementation(filename, root, ["packages"]), false);
  put("examples/new/modules/extra/package.json", '{"name":"extra"}');
  assert.ok(sources().has("extra"));
  fs.rmSync(manifest);
  assert.equal(sources().has("renamed"), false);
  put("custom/other/package.json", '{"name":"other"}');
  put("pnpm-workspace.yaml", 'packages:\n  - "custom/*"\n');
  assert.deepEqual(workspaceDirectories(root), ["custom/other"]);
  assert.ok(sources().has("other"));
  assert.equal(sources().has("extra"), false);
  assert.equal(sources(["custom"]).has("foreign"), false);
});

it("keeps source maps isolated by cwd and refreshes symlinked manifest directories", (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "source-symlink-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["one", "two"]) {
    fs.mkdirSync(path.join(root, name, "packages/bridge"), { recursive: true });
    fs.writeFileSync(
      path.join(root, name, "packages/bridge/package.json"),
      JSON.stringify({ name }),
    );
  }
  assert.ok(sourcePackages(path.join(root, "one"), ["packages"], []).has("one"));
  assert.ok(sourcePackages(path.join(root, "two"), ["packages"], []).has("two"));
  fs.mkdirSync(path.join(root, "linked"));
  fs.symlinkSync(path.join(root, "missing"), path.join(root, "linked/packages"));
  assert.equal(sourcePackages(path.join(root, "linked"), ["packages"], []).size, 0);
  fs.unlinkSync(path.join(root, "linked/packages"));
  fs.symlinkSync(path.join(root, "one/packages"), path.join(root, "linked/packages"));
  assert.ok(sourcePackages(path.join(root, "linked"), ["packages"], []).has("one"));
  fs.unlinkSync(path.join(root, "linked/packages"));
  fs.symlinkSync(path.join(root, "two/packages"), path.join(root, "linked/packages"));
  assert.ok(sourcePackages(path.join(root, "linked"), ["packages"], []).has("two"));
});
