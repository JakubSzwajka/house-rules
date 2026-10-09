import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import plugin, {
  RULES_PAGE_URL,
  ruleDocsUrl,
  SITE_URL as PLUGIN_SITE_URL,
} from "@house-rules/rules";
import { readRuleRows } from "../rule-rows.ts";
import { ruleAnchor } from "../rules-table.ts";
import { contentRoot, repoRoot, SITE_URL } from "../site-map.ts";

interface DependencyRule {
  readonly name: string;
  readonly comment?: string;
}

const { layout } = createRequire(import.meta.url)("@house-rules/rules/dependency-cruiser") as {
  layout(options: { readonly scope: string }): { readonly forbidden: readonly DependencyRule[] };
};

const BINS = join(repoRoot, "packages", "rules", "bin");

const binUrls = (): string[] =>
  readdirSync(BINS)
    .flatMap((file) =>
      [...readFileSync(join(BINS, file), "utf8").matchAll(/seeRuleLine\("([^"]+)"\)/g)].map(
        (match) => match[1] ?? "",
      ),
    )
    .map(ruleDocsUrl);

const emittedUrls = (): string[] => [
  ...Object.values(plugin.rules).map(({ meta }) => meta.docs?.url ?? ""),
  ...layout({ scope: "@acme/" }).forbidden.map(
    ({ comment }) => comment?.replace(/^See /, "") ?? "",
  ),
  ...binUrls(),
];

const page = readFileSync(join(contentRoot, "rules", "index.md"), "utf8");
const pageAnchors = new Set([...page.matchAll(/<span id="([^"]+)"><\/span>/g)].map((m) => m[1]));

describe("rule links the rules package emits", () => {
  it("use the site's canonical URL", () => {
    assert.equal(PLUGIN_SITE_URL, SITE_URL);
    assert.equal(RULES_PAGE_URL, `${SITE_URL}/rules/`);
  });

  it("emit a URL for every ESLint rule, Dependency Cruiser rule and bin", () => {
    const urls = emittedUrls();
    assert.equal(urls.filter((url) => url === "").length, 0);
    assert.ok(urls.length > Object.keys(plugin.rules).length + 3);
    assert.ok(binUrls().length >= 4, "pins, migrations and two layout checks");
  });

  it("each point at an anchor on the generated rules page", () => {
    for (const url of emittedUrls()) {
      assert.ok(url.startsWith(`${SITE_URL}/rules/#`), url);
      const anchor = url.slice(url.indexOf("#") + 1);
      assert.ok(pageAnchors.has(anchor), `${url} has no row on the rules page`);
    }
  });

  it("agree with the anchor the site gives each README row", () => {
    for (const row of readRuleRows()) {
      assert.equal(ruleDocsUrl(row.id), `${SITE_URL}/rules/#${ruleAnchor(row.id)}`);
    }
  });
});
