import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/pins.mjs", import.meta.url));

const checkManifest = (manifest) => {
  const dir = mkdtempSync(join(tmpdir(), "check-exact-pins-"));
  try {
    const path = join(dir, "package.json");
    writeFileSync(path, JSON.stringify(manifest));
    return spawnSync(process.execPath, [script, path], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const checkWorkspace = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "check-exact-pins-workspace-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(
        join(dir, path),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    }
    return spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const WORKSPACE_YAML = 'packages:\n  - "apps/*"\n  - packages/*\n\nsaveExact: true\n';

describe("house-rules-pins", () => {
  it("is the package bin", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(manifest.bin["house-rules-pins"], "bin/pins.mjs");
    assert.match(fs.readFileSync(script, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});

describe("exact pin check", () => {
  it("accepts exact versions, prereleases, aliases, and commit-pinned GitHub specs", () => {
    const result = checkManifest({
      dependencies: { a: "1.2.3", b: "4.0.0-rc.1", c: "npm:real-name@2.0.0" },
      devDependencies: { d: "github:owner/repo#012daeb0d1809f0e026b9425dddc9a42a77c3328" },
      optionalDependencies: { e: "workspace:0.0.0" },
      packageManager: "pnpm@12.5.1",
    });
    assert.equal(result.status, 0, result.stderr);
  });

  const looseSpecs = [
    "^1.2.3",
    "~1.2.3",
    ">=1.0.0",
    "latest",
    "*",
    "github:owner/repo#main",
    "workspace:*",
    "workspace:^",
    "workspace:^0.0.0",
  ];
  for (const spec of looseSpecs) {
    it(`rejects ${spec}`, () => {
      const result = checkManifest({ devDependencies: { loose: spec } });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(`devDependencies\\.loose: ${spec.replace(/[\^*]/g, "\\$&")}`),
      );
    });
  }

  const SHA = "012daeb0d1809f0e026b9425dddc9a42a77c3328";

  for (const spec of [
    `github:owner/repo#${SHA}&path:/packages/rules`,
    `git+https://github.com/owner/repo.git#${SHA}&path:/packages/rules`,
    `git+ssh://git@github.com/owner/repo.git#${SHA}&path:/rules`,
  ]) {
    it(`accepts a commit-pinned Git spec with a subpath: ${spec}`, () => {
      const result = checkManifest({ devDependencies: { pinned: spec } });
      assert.equal(result.status, 0, result.stderr);
    });
  }

  for (const spec of [
    "github:owner/repo#main&path:/packages/rules",
    "github:owner/repo#012daeb&path:/packages/rules",
    "github:owner/repo&path:/packages/rules",
    `github:owner/repo#${SHA}&path:`,
    `github:owner/repo#${SHA}&path:/`,
    `github:owner/repo#${SHA}&path:/../rules`,
    `github:owner/repo#${SHA}&path:/packages/../rules`,
    `github:owner/repo#${SHA}&path:/packages/..`,
    `github:owner/repo#${SHA}&path:/./rules`,
    `github:owner/repo#${SHA}&path://packages/rules`,
    `github:owner/repo#${SHA}&path:/packages//rules`,
    `github:owner/repo#${SHA}&path:/packages/rules/`,
    `github:owner/repo#${SHA}&path:/packages/rules&path:/other`,
  ]) {
    it(`rejects a subpath spec that is not pinned to a full commit or has a bad path: ${spec}`, () => {
      const result = checkManifest({ devDependencies: { loose: spec } });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`devDependencies.loose: ${spec}`), result.stderr);
    });
  }

  it("rejects a packageManager without an exact version", () => {
    const result = checkManifest({ packageManager: "pnpm@latest" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packageManager: pnpm@latest/);
  });

  it("checks the root and every workspace package.json when given no path", () => {
    const result = checkWorkspace({
      "pnpm-workspace.yaml": WORKSPACE_YAML,
      "package.json": { devDependencies: { a: "1.2.3" } },
      "apps/web/package.json": { dependencies: { b: "workspace:0.0.0" } },
      "packages/core/package.json": { dependencies: { c: "^4.0.0" } },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/core\/package\.json[\s\S]*dependencies\.c: \^4\.0\.0/);
    assert.doesNotMatch(result.stderr, /apps\/web/);
  });

  it("passes a workspace whose manifests are all exact", () => {
    const result = checkWorkspace({
      "pnpm-workspace.yaml": WORKSPACE_YAML,
      "package.json": { devDependencies: { a: "1.2.3" } },
      "apps/web/package.json": { dependencies: { b: "workspace:0.0.0" } },
      "packages/core/package.json": { dependencies: { c: "4.0.0" } },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /apps\/web\/package\.json, packages\/core\/package\.json/);
  });

  it("checks nested workspace globs, such as an example's apps and packages", () => {
    const result = checkWorkspace({
      "pnpm-workspace.yaml":
        'packages:\n  - "apps/*"\n  - packages/*\n  - "examples/*/apps/*"\n  - "examples/*/packages/*"\n',
      "package.json": { devDependencies: { a: "1.2.3" } },
      "examples/shop/apps/api/package.json": { dependencies: { b: "workspace:0.0.0" } },
      "examples/shop/packages/orders/package.json": { dependencies: { c: "~4.0.0" } },
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /examples\/shop\/packages\/orders\/package\.json[\s\S]*dependencies\.c: ~4\.0\.0/,
    );
    assert.doesNotMatch(result.stderr, /examples\/shop\/apps/);
  });

  it("fails when pnpm-workspace.yaml lists no packages", () => {
    const result = checkWorkspace({
      "pnpm-workspace.yaml": "saveExact: true\n",
      "package.json": { devDependencies: { a: "1.2.3" } },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no `packages:` list/);
  });
});
