import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = new URL("..", import.meta.url);
const directory = mkdtempSync(path.join(tmpdir(), "plan-cli-"));
after(() => rmSync(directory, { recursive: true, force: true }));

const plan = {
  modules: [
    {
      name: "notes",
      service: "test/Notes",
      kind: "package",
      operations: [
        { name: "Notes.list", permission: "notes:read", readOnly: true },
        { name: "Notes.add", permission: "notes:write", transactional: true },
      ],
    },
  ],
  features: [
    { name: "list_notes", permission: null, readOnly: true, edges: ["Notes.list"] },
    { name: "add_note", permission: null, edges: ["Notes.add"] },
  ],
  ways: [
    {
      name: "web",
      protocol: "http",
      path: "/api",
      mean: "no",
      features: ["list_notes", "add_note"],
    },
  ],
};
const file = (name, value) => {
  const target = path.join(directory, name);
  writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  return target;
};
const valid = file("plan.json", plan);
const invalid = file("invalid.json", {
  ...plan,
  features: [...plan.features, { name: "orphan", permission: null, edges: ["Notes.gone"] }],
  ways: [{ ...plan.ways[0], features: ["list_notes", "missing_feature"] }],
});
const changed = file("changed.json", {
  ...plan,
  features: [...plan.features, { name: "count_notes", permission: null, edges: ["Notes.list"] }],
});
const runPlan = (...args) =>
  spawnSync(process.execPath, ["scripts/plan.mjs", ...args], { cwd: root, encoding: "utf8" });

it("plan view renders a valid plan as one html page and exits 0", () => {
  const result = runPlan("view", valid);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<!doctype html>/u);
  for (const name of ["web", "list_notes", "add_note", "Notes.list", "Notes.add"])
    assert.ok(result.stdout.includes(`>${name}<`), name);
  const out = path.join(directory, "view.html");
  const written = runPlan("view", valid, "-o", out);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(readFileSync(out, "utf8"), result.stdout);
});

it("plan view prints every issue path of an invalid plan and exits 1", () => {
  const result = runPlan("view", invalid);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /plan has 2 issues/u);
  assert.match(result.stderr, /features\[2\]\.edges\[0\]: Unresolved edge target Notes\.gone/u);
  assert.match(result.stderr, /ways\[0\]\.features\[1\]: web exposes missing_feature/u);
  assert.equal(runPlan("view", file("broken.json", "{ nope")).status, 1);
});

it("plan validate prints valid or issue paths, never a page, and exits 0/1/2", () => {
  const result = runPlan("validate", valid);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "valid\n");
  assert.equal(result.stderr, "");
  const rejected = runPlan("validate", invalid);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /features\[2\]\.edges\[0\]/u);
  for (const [name, input, issue] of [
    ["unknown-root", { ...plan, layers: "snapshot" }, '["layers"]'],
    [
      "unknown-feature",
      { ...plan, features: [{ ...plan.features[0], flags: { readOnly: true } }] },
      '["features"][0]["flags"]',
    ],
    [
      "unknown-closure",
      { ...plan, features: [{ ...plan.features[0], closures: { person: [] } }] },
      '["features"][0]["closures"]',
    ],
    ["shape", { modules: [], features: [], ways: [{}] }, '["ways"][0]'],
  ]) {
    const failed = runPlan("validate", file(`${name}.json`, input));
    assert.equal(failed.status, 1, failed.stderr);
    assert.ok(failed.stderr.includes(issue), failed.stderr);
  }
  assert.equal(runPlan("validate", file("invalid-json.json", "{ nope")).status, 1);
  assert.equal(runPlan("validate", path.join(directory, "missing.json")).status, 1);
  assert.equal(runPlan("validate").status, 2);
  assert.equal(runPlan("validate", valid, valid).status, 2);
  assert.equal(runPlan("validate", valid, "--text").status, 2);
  const forbiddenOutput = path.join(directory, "never.html");
  assert.equal(runPlan("validate", valid, "-o", forbiddenOutput).status, 2);
  assert.equal(existsSync(forbiddenOutput), false);
  assert.match(runPlan("--help").stdout, /plan validate <plan.json>/u);
});

it("plan diff shows no change for the same plan and names an added feature", () => {
  const same = runPlan("diff", valid, valid, "--text");
  assert.equal(same.status, 0, same.stderr);
  assert.equal(same.stdout, "MAP DIFF\n No changes: both maps describe the same app.\n");
  const diff = runPlan("diff", valid, changed, "--text");
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /new features: count_notes/u);
  const out = path.join(directory, "diff.html");
  assert.equal(runPlan("diff", valid, changed, "-o", out).status, 0);
  assert.match(readFileSync(out, "utf8"), /<li>new features: count_notes<\/li>/u);
  assert.equal(runPlan("diff", valid, invalid).status, 1);
  assert.equal(runPlan("diff", valid).status, 2);
});
