import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readRuleRows, TOOLS } from "../rule-rows.ts";
import { ruleAnchor } from "../rules-table.ts";
import { contentRoot, siteRoot } from "../site-map.ts";

const caddyfile = readFileSync(join(siteRoot, "Caddyfile"), "utf8");
const redirectLines = [...caddyfile.matchAll(/^\s*redir (\S+) (\S+) 301$/gm)].map(
  (match) => [match[1] ?? "", match[2] ?? ""] as const,
);
const redirects = new Map<string, string>(redirectLines);

const oldSlug = (id: string): string =>
  // the pre-cut page slug, frozen because old links use it
  id
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const startHeadings = [
  ...readFileSync(join(contentRoot, "start", "index.md"), "utf8").matchAll(/^## (.+)$/gm),
].map((match) => (match[1] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));

describe("Caddy redirects", () => {
  it("send every old rule page to its row", () => {
    for (const row of readRuleRows()) {
      const from = `/rules/${row.tool.slug}/${oldSlug(row.id)}/`;
      assert.equal(redirects.get(from), `/rules/#${ruleAnchor(row.id)}`, from);
    }
  });

  it("send every old tool page and start page to a live page", () => {
    for (const tool of TOOLS) {
      assert.equal(redirects.get(`/rules/${tool.slug}/`), "/rules/");
    }
    for (const page of ["adopt", "what-is-house-rules", "for-agents"]) {
      assert.equal(redirects.get(`/start/${page}/`), "/start/");
    }
    for (const section of ["guides", "reference", "skills"]) {
      assert.equal(redirects.get(`/${section}/*`), "/start/");
    }
  });

  it("send any retired .md URL to llms.txt, after every other redirect", () => {
    const [name, target] = redirectLines.at(-1) ?? [];
    assert.equal(target, "/llms.txt");
    assert.match(caddyfile, new RegExp(`^\\s*${name} path \\*\\.md$`, "m"));
    assert.equal(
      redirectLines.filter(([from]) => from.endsWith(".md") || from.startsWith("@")).length,
      1,
    );
  });

  it("point only at the two pages, their anchors, and llms.txt", () => {
    const anchors = new Set(readRuleRows().map((row) => ruleAnchor(row.id)));
    for (const [from, to] of redirects) {
      const [path, hash] = to.split("#");
      if (path === "/rules/") {
        assert.ok(hash === undefined || anchors.has(hash), `${from} -> ${to}`);
      } else if (path === "/start/") {
        assert.ok(hash === undefined || startHeadings.includes(hash), `${from} -> ${to}`);
      } else {
        assert.equal(to, "/llms.txt", from);
      }
    }
  });
});
