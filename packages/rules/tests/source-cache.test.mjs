import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { cachedFile, sourceGlob } from "../src/source-cache.mjs";

const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "source-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

const mockGlob = (t, implementation) => {
  t.mock.method(fs, "globSync", implementation);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
};

it("does not retain a scan when a manifest appears after the file glob", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "packages/one"), { recursive: true });
  const original = fs.globSync;
  let raced = false;
  mockGlob(t, (patterns, options) => {
    const result = original(patterns, options);
    if (!options.withFileTypes && !raced) {
      raced = true;
      fs.writeFileSync(path.join(root, "packages/one/package.json"), "{}");
    }
    return result;
  });
  assert.deepEqual(sourceGlob(root, ["packages/*/package.json"]), []);
  assert.deepEqual(sourceGlob(root, ["packages/*/package.json"]), ["packages/one/package.json"]);
});

it("does not retain a scan when the watched directory set changes", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "packages"));
  const original = fs.globSync;
  let raced = false;
  let fileGlobs = 0;
  mockGlob(t, (patterns, options) => {
    const result = original(patterns, options);
    if (!options.withFileTypes) fileGlobs++;
    if (options.withFileTypes && !raced) {
      raced = true;
      fs.mkdirSync(path.join(root, "packages/new"));
    }
    return result;
  });
  sourceGlob(root, ["packages/*/package.json"]);
  sourceGlob(root, ["packages/*/package.json"]);
  assert.equal(fileGlobs, 2);
});

it("evicts the least recently used file after 2048 entries", (t) => {
  const root = fixture(t);
  const reads = new Map();
  const read = (file) => {
    reads.set(file, (reads.get(file) ?? 0) + 1);
    return path.basename(file);
  };
  const files = Array.from({ length: 2049 }, (_, i) => path.join(root, `${i}.ts`));
  for (const file of files) fs.writeFileSync(file, "");
  for (const file of files.slice(0, 2048)) cachedFile(file, read);
  cachedFile(files[0], read);
  cachedFile(files[2048], read);
  cachedFile(files[0], read);
  cachedFile(files[1], read);
  assert.equal(reads.get(files[0]), 1);
  assert.equal(reads.get(files[1]), 2);
});

it("evicts the least recently used directory scan after 128 entries", (t) => {
  const root = fixture(t);
  const original = fs.globSync;
  const reads = new Map();
  mockGlob(t, (patterns, options) => {
    if (!options.withFileTypes) reads.set(patterns[0], (reads.get(patterns[0]) ?? 0) + 1);
    return original(patterns, options);
  });
  const patterns = Array.from({ length: 129 }, (_, i) => [`missing-${i}/*.json`]);
  for (const pattern of patterns.slice(0, 128)) sourceGlob(root, pattern);
  sourceGlob(root, patterns[0]);
  sourceGlob(root, patterns[128]);
  sourceGlob(root, patterns[0]);
  sourceGlob(root, patterns[1]);
  assert.equal(reads.get(patterns[0][0]), 1);
  assert.equal(reads.get(patterns[1][0]), 2);
});
