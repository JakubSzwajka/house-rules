import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GENERATE_COMMAND } from "../generated-page.ts";
import { generatedPages, staleGeneratedPages } from "../generation.ts";
import { rawPath } from "../links.ts";
import { llmsFileAt, llmsFiles, readContentPages, writeLlmsFiles } from "../llms-files.ts";
import { readRuleRows } from "../rule-rows.ts";
import { retargetHtml } from "../source-links.ts";
import { atSourceRef, GITHUB_REPO, SITE_URL } from "../site-map.ts";
import { readSkills } from "../skill-pages.ts";

const pages = generatedPages();
const paths = new Set(pages.map((page) => page.path));

describe("generated pages", () => {
  it("match the committed files, so nobody hand-edits them", () => {
    assert.deepEqual(staleGeneratedPages(pages), [], `Run: ${GENERATE_COMMAND}`);
  });

  it("give every row of the rules table its own page", () => {
    const rows = readRuleRows();
    assert.ok(rows.length >= 30, `only ${rows.length} rules parsed from the rules table`);
    for (const row of rows) {
      assert.ok(paths.has(`rules/${row.tool.slug}/${row.slug}.md`), `no page for rule ${row.id}`);
    }
    const rulePages = [...paths].filter(
      (path) => path.startsWith("rules/") && !path.endsWith("index.md"),
    );
    assert.equal(rulePages.length, rows.length);
  });

  it("give every skill its own page", () => {
    const skills = readSkills();
    assert.ok(skills.length > 0);
    for (const skill of skills) {
      assert.ok(paths.has(`skills/${skill.name}.md`), `no page for skill ${skill.name}`);
    }
  });
});

describe("agent-readable output", () => {
  const content = readContentPages();
  const files = llmsFiles(content);

  it("writes llms.txt, llms-full.txt and one Markdown copy per page", () => {
    const outDir = mkdtempSync(join(tmpdir(), "house-rules-site-"));
    try {
      writeLlmsFiles(outDir);
      for (const path of [
        "llms.txt",
        "llms-full.txt",
        ...content.map((page) => rawPath(page.contentPath)),
      ]) {
        assert.ok(existsSync(join(outDir, path)), `missing ${path}`);
      }
      const index = readFileSync(join(outDir, "llms.txt"), "utf8");
      const full = readFileSync(join(outDir, "llms-full.txt"), "utf8");
      for (const page of content) {
        if (page.contentPath !== "index.md") {
          assert.ok(
            index.includes(`(${SITE_URL}/${rawPath(page.contentPath)})`),
            `llms.txt misses ${page.contentPath}`,
          );
        }
        assert.ok(full.includes(`# ${page.title}\n`), `llms-full.txt misses ${page.contentPath}`);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("serves the same files in dev that the build writes", () => {
    assert.equal(llmsFileAt("/llms.txt")?.text, files.get("llms.txt"));
    assert.equal(llmsFileAt("/llms.txt")?.contentType, "text/plain; charset=utf-8");
    const page = rawPath("guides/the-fence.md");
    assert.equal(llmsFileAt(`/${page}?x=1`)?.text, files.get(page));
    assert.equal(llmsFileAt(`/${page}`)?.contentType, "text/markdown; charset=utf-8");
    assert.equal(llmsFileAt("/guides/the-fence/"), undefined);
    assert.equal(llmsFileAt("/nothing.md"), undefined);
  });

  it("names the source ref and points every source link at it", () => {
    const ref = "docs/site";
    const branch = llmsFiles(content, ref);
    const index = branch.get("llms.txt") ?? "";
    assert.ok(index.includes("`docs/site` ref"), "llms.txt does not name the ref");
    assert.ok(!index.includes("code on main"), "llms.txt still claims main");
    for (const [path, text] of branch) {
      assert.ok(
        !new RegExp(`${GITHUB_REPO}/(?:blob|tree)/main/`).test(text),
        `${path} links to main`,
      );
    }
    const full = branch.get("llms-full.txt") ?? "";
    assert.ok(full.includes(`${GITHUB_REPO}/blob/docs/site/skills/`), "no skill link at the ref");
  });

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

  it("links only to pages that exist", () => {
    const linked = [...files.values()].flatMap((text) =>
      [...text.matchAll(new RegExp(`${SITE_URL}/([a-z0-9][a-z0-9/-]*\\.md)`, "g"))].map(
        (match) => match[1],
      ),
    );
    assert.ok(linked.length > 0);
    for (const path of linked) {
      assert.ok(
        path !== undefined && files.has(path),
        `link to a page that does not exist: ${path}`,
      );
    }
  });
});
