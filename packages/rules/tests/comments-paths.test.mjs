import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { invoke, withWorkspace } from "./comments-workspace.mjs";

for (const file of [
  "Dockerfile",
  "Dockerfile.dev",
  "api.Dockerfile",
  "Containerfile",
  "Containerfile.dev",
  "api.Containerfile",
]) {
  test(`CLI checks ${file}`, () => {
    withWorkspace((cwd) => {
      writeFileSync(path.join(cwd, file), "# header prose\nFROM alpine\n");
      const result = invoke(cwd, file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /:1: Rework this comment:/u);
    });
  });
}

for (const file of ["notes.md", "Dockerfile.dockerignore"]) {
  test(`CLI rejects explicit unsupported ${file}`, () => {
    withWorkspace((cwd) => {
      writeFileSync(path.join(cwd, file), "# not a supported language\n");
      const result = invoke(cwd, file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unsupported file type/u);
    });
  });
}

test("default skips tracked deletions and symlinks, explicit missing fails", () => {
  withWorkspace((cwd) => {
    spawnSync("git", ["init", "-q"], { cwd });
    writeFileSync(path.join(cwd, "deleted.py"), "value = 1\n");
    writeFileSync(path.join(cwd, "kept.py"), "value = 1\n");
    symlinkSync("kept.py", path.join(cwd, "link.py"));
    spawnSync("git", ["add", "deleted.py", "kept.py", "link.py"], { cwd });
    unlinkSync(path.join(cwd, "deleted.py"));
    const result = invoke(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 file\(s\) checked/u);
    assert.equal(invoke(cwd, "deleted.py").status, 1);
  });
});

test("explicit paths accept cwd-contained relative, dot and absolute files", () => {
  withWorkspace((cwd) => {
    mkdirSync(path.join(cwd, "config"));
    writeFileSync(path.join(cwd, "config/app.py"), "value = 1\n");
    for (const input of ["config/app.py", "./config/app.py", path.join(cwd, "config/app.py")]) {
      const result = invoke(cwd, input);
      assert.equal(result.status, 0, `${input}: ${result.stderr}`);
      assert.match(result.stdout, /1 file\(s\) checked/u);
    }
  });
});

test("explicit symlinks, symlink parents and outside paths fail visibly", () => {
  withWorkspace((cwd) => {
    mkdirSync(path.join(cwd, "real"));
    writeFileSync(path.join(cwd, "real/app.py"), "value = 1\n");
    symlinkSync("real", path.join(cwd, "alias"));
    symlinkSync("real/app.py", path.join(cwd, "link.py"));
    for (const input of [
      "link.py",
      "alias/app.py",
      "alias/*.py",
      "../outside.py",
      path.join(cwd, "../outside.py"),
    ]) {
      const result = invoke(cwd, input);
      assert.equal(result.status, 1, input);
      assert.match(result.stderr, /symlink|outside|parent/u);
    }
  });
});

test("explicit workflow globs work and prune metadata and dependency trees", () => {
  withWorkspace((cwd) => {
    for (const dir of [".git", "node_modules", "nested/node_modules"]) {
      mkdirSync(path.join(cwd, dir), { recursive: true });
      writeFileSync(path.join(cwd, dir, "noise.py"), "# header\nvalue = 1\n");
    }
    writeFileSync(path.join(cwd, ".github/workflows/ci.yml"), "name: ci\n");
    writeFileSync(path.join(cwd, "kept.py"), "value = 1\n");
    assert.equal(invoke(cwd, ".github/**/*.yml").status, 0);
    const result = invoke(cwd, "**/*.py");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 file\(s\) checked/u);
  });
});
