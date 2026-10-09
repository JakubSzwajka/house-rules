import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { layout } from "../src/dependency-cruiser.cjs";
import plugin, { ruleAnchor, ruleDocsUrl, RULES_PAGE_URL, SITE_URL } from "../src/index.mjs";
import { cruiseFixture } from "./dependency-cruiser-helpers.mjs";
import { run as runMigrations } from "./migrations-helpers.mjs";

const bin = (name) => fileURLToPath(new URL(`../bin/${name}.mjs`, import.meta.url));
const README = fileURLToPath(new URL("../README.md", import.meta.url));

// The ids in the README rules table, the same reading the docs site makes
const readmeRuleIds = () => {
  const section = fs
    .readFileSync(README, "utf8")
    .split(/^## Rules and checks$/mu)[1]
    ?.split(/^## /mu)[0];
  assert.ok(section, "README has no Rules and checks section");
  return section
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .split("|")[1]
        .trim()
        .replace(/ \(.*\)$/u, "")
        .replaceAll("`", ""),
    );
};

const anchors = new Set(readmeRuleIds().map(ruleAnchor));

const assertSeeLine = (stderr, id) => {
  const url = ruleDocsUrl(id);
  assert.ok(anchors.has(url.split("#")[1]), `${url} has no row in the README rules table`);
  const lines = stderr.trimEnd().split("\n");
  assert.equal(lines.at(-1), `See ${url}`);
  assert.equal(lines.filter((line) => line.startsWith("See ")).length, 1);
};

describe("rule docs links", () => {
  it("builds the site URL from the README row id", () => {
    assert.equal(SITE_URL, "https://stack.kubaszwajka.com");
    assert.equal(RULES_PAGE_URL, `${SITE_URL}/rules/`);
    assert.equal(ruleDocsUrl("comment-discipline"), `${SITE_URL}/rules/#comment-discipline`);
    assert.equal(ruleDocsUrl("noReExportAll"), `${SITE_URL}/rules/#noReExportAll`);
    assert.equal(ruleDocsUrl("shadcn/*"), `${SITE_URL}/rules/#shadcn`);
    assert.equal(ruleDocsUrl("Exact pins"), `${SITE_URL}/rules/#exact-pins`);
    assert.equal(ruleDocsUrl("Strict compiler flags"), `${SITE_URL}/rules/#strict-compiler-flags`);
  });

  it("gives every ESLint rule of the plugin a docs URL on a README row", () => {
    const names = Object.keys(plugin.rules);
    assert.ok(names.length > 0);
    for (const name of names) {
      const url = plugin.rules[name].meta.docs.url;
      assert.equal(url, ruleDocsUrl(name), name);
      assert.ok(anchors.has(url.split("#")[1]), `${name}: ${url} has no README row`);
    }
  });

  it("gives every Dependency Cruiser rule a comment with the link to its README row", () => {
    const { forbidden } = layout({ scope: "@acme/" });
    for (const { name, comment } of forbidden) {
      assert.equal(comment, `See ${ruleDocsUrl(name)}`, name);
      assert.ok(anchors.has(ruleAnchor(name)), `${name} has no README row`);
    }
  });

  it("ends a failing house-rules-pins run with the link, once", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rule-docs-pins-"));
    try {
      const manifest = path.join(dir, "package.json");
      writeFileSync(manifest, JSON.stringify({ dependencies: { left: "^1.0.0" } }));
      const result = spawnSync(process.execPath, [bin("pins"), manifest], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assertSeeLine(result.stderr, "Exact pins");
      assert.match(result.stderr, /left: \^1\.0\.0/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ends a failing house-rules-migrations run with the link, once", () => {
    const result = runMigrations({
      "packages/trips/stray.sql": "create table a (id text);\n",
      "packages/trips/other.sql": "create table b (id text);\n",
    });
    assert.equal(result.status, 1, result.stderr);
    assertSeeLine(result.stderr, "house-rules-migrations");
  });

  it("ends a failing house-rules-layout run with the link for each failing check", async () => {
    const config = layout({ scope: "@acme/" });
    const runFixture = (fixture) =>
      cruiseFixture(fixture, config, ({ workspace }) => {
        writeFileSync(
          path.join(workspace, ".dependency-cruiser.cjs"),
          `module.exports = ${JSON.stringify(config)};\n`,
        );
        return spawnSync(process.execPath, [bin("layout"), "--cwd", workspace], {
          encoding: "utf8",
        });
      });
    const packages = await runFixture("package-graph-cycle");
    assert.equal(packages.status, 1, packages.stderr);
    assertSeeLine(packages.stderr, "no-package-cycles");
    const subjects = await runFixture("subject-folder-cycles/production-two-folder-cycle");
    assert.equal(subjects.status, 1, subjects.stderr);
    assertSeeLine(subjects.stderr, "no-subject-folder-cycles");
  });
});
