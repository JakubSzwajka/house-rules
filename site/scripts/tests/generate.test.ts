import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GENERATE_COMMAND } from "../generated-page.ts";
import { generatedPages, staleGeneratedPages } from "../generation.ts";
import { llmsFileAt, llmsText, writeLlmsFile } from "../llms-files.ts";
import type { RuleRow } from "../rule-rows.ts";
import { readRuleRows, TOOLS } from "../rule-rows.ts";
import { refusalFor, ruleAnchor, SHADCN_ROW } from "../rules-table.ts";
import { retargetHtml } from "../source-links.ts";
import { atSourceRef, GITHUB_REPO, SITE_URL } from "../site-map.ts";

const pages = generatedPages();
const rows = readRuleRows();
const eslint = TOOLS.find((tool) => tool.slug === "eslint");
assert.ok(eslint);

const fakeRow = (id: string, catches = "Something"): RuleRow => ({
  id,
  catches,
  tool: eslint,
  enableVia: "x",
  docPath: "packages/rules/docs/x.md",
  docHash: "",
});

describe("generated pages", () => {
  it("match the committed files, so nobody hand-edits them", () => {
    assert.deepEqual(staleGeneratedPages(pages), [], `Run: ${GENERATE_COMMAND}`);
  });

  it("are the one rules page", () => {
    assert.deepEqual(
      pages.map((page) => page.path),
      ["rules/index.md"],
    );
  });
});

describe("rules page", () => {
  const text = pages[0]?.text ?? "";
  const anchors = [...text.matchAll(/<span id="([^"]+)"><\/span>/g)].map((match) => match[1]);

  it("has one row with one anchor per row of the rules table", () => {
    assert.ok(rows.length >= 30, `only ${rows.length} rules parsed from the rules table`);
    assert.deepEqual(
      anchors,
      rows.map((row) => ruleAnchor(row.id)),
    );
    assert.equal(new Set(anchors).size, anchors.length, "two rules share an anchor");
  });

  it("keeps the anchors error messages link to", () => {
    for (const anchor of [
      "comment-discipline",
      "no-hand-rolled-surface",
      "shadcn",
      "house-rules-migrations",
      "strict-compiler-flags",
      "noReExportAll",
    ]) {
      assert.ok(anchors.includes(anchor), `no #${anchor}`);
    }
  });

  it("slugifies only ids that are not already an anchor", () => {
    assert.equal(ruleAnchor("no-cycles"), "no-cycles");
    assert.equal(ruleAnchor("useFilenamingConvention"), "useFilenamingConvention");
    assert.equal(ruleAnchor("shadcn/*"), "shadcn");
    assert.equal(ruleAnchor("Exact pins"), "exact-pins");
  });

  it("links every row to its docs on GitHub", () => {
    for (const row of rows) {
      assert.ok(
        text.includes(`(${GITHUB_REPO}/blob/main/${row.docPath}${row.docHash})`),
        `no source link for ${row.id}`,
      );
    }
  });
});

describe("what a rule refuses", () => {
  it("uses the first sentence of an ESLint rule's own description", () => {
    const rules = { x: { meta: { docs: { description: "Forbid run* and a_b. Tests do it." } } } };
    assert.equal(refusalFor(fakeRow("x"), rules), "Forbid `run*` and a\\_b.");
    const css = { x: { meta: { docs: { description: "Require var(--name), always." } } } };
    assert.equal(refusalFor(fakeRow("x"), css), "Require `var(--name)`, always.");
  });

  it("gives the shadcn row its README sentence", () => {
    const shadcn = rows.find((row) => row.id === SHADCN_ROW);
    assert.ok(shadcn, "the rules table has no shadcn row");
    assert.equal(refusalFor(shadcn), `${shadcn.catches}.`);
  });

  it("does not treat any other namespaced ESLint row as shadcn", () => {
    assert.throws(() => refusalFor(fakeRow("other/*")), /no such rule/);
    assert.throws(() => refusalFor(fakeRow("shadcn/no-restyle")), /no such rule/);
  });
});

describe("llms.txt", () => {
  const text = llmsText();

  it("names both pages, AGENTS.md and the repository", () => {
    for (const part of [`${SITE_URL}/start/`, `${SITE_URL}/rules/`, "`AGENTS.md`", GITHUB_REPO]) {
      assert.ok(text.includes(part), `llms.txt misses ${part}`);
    }
    assert.ok(text.includes("node_modules/@house-rules/capability/AGENTS.md"));
  });

  it("is the only file the build adds", () => {
    const outDir = mkdtempSync(join(tmpdir(), "house-rules-site-"));
    try {
      writeLlmsFile(outDir);
      assert.deepEqual(readdirSync(outDir), ["llms.txt"]);
      assert.equal(readFileSync(join(outDir, "llms.txt"), "utf8"), text);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("serves the same file in dev, and nothing else", () => {
    assert.equal(llmsFileAt("/llms.txt?x=1")?.text, text);
    assert.equal(llmsFileAt("/llms.txt")?.contentType, "text/plain; charset=utf-8");
    assert.equal(llmsFileAt("/llms-full.txt"), undefined);
    assert.equal(llmsFileAt("/rules.md"), undefined);
  });
});

describe("source links", () => {
  it("retargets only this repository's source links", () => {
    const own = `${GITHUB_REPO}/blob/main/skills/x/SKILL.md`;
    const other = "https://github.com/someone/else/blob/main/a.md";
    assert.equal(
      atSourceRef(`${own} ${other}`, "v1.2.0"),
      `${GITHUB_REPO}/blob/v1.2.0/skills/x/SKILL.md ${other}`,
    );
    assert.equal(
      atSourceRef(`${GITHUB_REPO}/tree/main/skills`, "abc123"),
      `${GITHUB_REPO}/tree/abc123/skills`,
    );
  });

  it("retargets source links in built HTML and leaves other pages alone", () => {
    const outDir = mkdtempSync(join(tmpdir(), "house-rules-html-"));
    try {
      mkdirSync(join(outDir, "a"));
      writeFileSync(
        join(outDir, "a", "index.html"),
        `<a href="${GITHUB_REPO}/blob/main/x.md">x</a>`,
      );
      writeFileSync(join(outDir, "b.html"), "<p>no links</p>");
      assert.equal(retargetHtml(outDir, "docs/site"), 1);
      assert.equal(
        readFileSync(join(outDir, "a", "index.html"), "utf8"),
        `<a href="${GITHUB_REPO}/blob/docs/site/x.md">x</a>`,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
