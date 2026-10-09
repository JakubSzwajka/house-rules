import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readRuleRows, TOOLS } from "../rule-rows.ts";
import { ruleAnchor } from "../rules-table.ts";
import { contentRoot, repoRoot, siteRoot } from "../site-map.ts";

const quotedRefusals = [
  {
    source: "scripts/vcs-command-policy.mjs",
    quote:
      "Blocked hook bypass. Do not use --no-verify, git commit -n, core.hooksPath, or LEFTHOOK=0.",
  },
  {
    source: "packages/rules/bin/migrations.mjs",
    quote: "`  ${relative(file)}:${line}: ${message}`",
  },
  {
    source: "packages/rules/bin/migrations.mjs",
    quote: 'SQL names "${tableName(name)}", a table ${other} owns.',
  },
  { source: "packages/rules/src/no-hand-rolled-surface.mjs", quote: "builds a surface by hand." },
] as const;

const tableRefusal =
  'packages/trips/src/list.ts:1: SQL names "bookings", a table packages/bookings owns.';
const demoSource = join(siteRoot, "src", "components", "refusal-demo.astro");

const index = join(siteRoot, "dist", "index.html");
const skip = existsSync(index)
  ? false
  : "site/dist is absent; run `pnpm --filter @house-rules/site build` first";

const text = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("home refusal quotes", () => {
  for (const { source, quote } of quotedRefusals) {
    it(`${source} still says the quoted text`, () => {
      assert.ok(readFileSync(join(repoRoot, source), "utf8").includes(quote), quote);
    });
  }
});

describe("refusal demo source", () => {
  const source = readFileSync(demoSource, "utf8");
  const script = source.slice(
    source.lastIndexOf("<script>"),
    source.indexOf("</script>", source.lastIndexOf("<script>")),
  );

  it("keeps a tabpanel off an element that cannot carry the role", () => {
    assert.doesNotMatch(source, /<article\b/, "an article cannot be role=tabpanel");
  });

  it("settles when reduced motion switches on, and on every reduced-motion play", () => {
    assert.match(
      script,
      /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.addEventListener\("change"/,
    );
    const settle = /const settle = \(\): void => \{([\s\S]*?)\n    \};/.exec(script)?.[1] ?? "";
    for (const step of ["stop()", "clearHighlights()", "delete panel.dataset.stage"]) {
      assert.ok(settle.includes(step), `settle() misses ${step}`);
    }
    assert.match(script, /if \(still\(\)\) \{\s*settle\(\);\s*tighten\(true\);/);
  });

  it("only hides typed text while motion is allowed", () => {
    const rule = /@media \(prefers-reduced-motion: no-preference\) \{\s*::highlight\(hr-pending\)/;
    assert.match(source, rule);
  });

  it("says vertical when the tabs stack", () => {
    assert.match(script, /aria-orientation", stacked\.matches \? "vertical" : "horizontal"/);
  });
});

const startHeadings = [
  ...readFileSync(join(contentRoot, "start", "index.md"), "utf8").matchAll(/^## (.+)$/gm),
].map((match) => (match[1] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
const anchors = new Set(readRuleRows().map((row) => ruleAnchor(row.id)));

const liveTarget = (href: string): boolean => {
  const [path, hash] = href.split("#");
  if (path === "/start/") return hash === undefined || startHeadings.includes(hash);
  if (path === "/rules/") return hash === undefined || anchors.has(hash);
  return false;
};

describe("home links", () => {
  it("send the hero actions to the start page", () => {
    const home = readFileSync(join(contentRoot, "index.md"), "utf8");
    const links = [...home.matchAll(/^\s+link: (\S+)$/gm)].map((match) => match[1] ?? "");
    assert.deepEqual(links, ["/start/", "/start/#what-it-is"]);
    for (const link of links) assert.ok(liveTarget(link), link);
  });

  it("send each demo case to a live anchor", () => {
    const links = [...readFileSync(demoSource, "utf8").matchAll(/^\s+link: "([^"]+)",$/gm)].map(
      (match) => match[1] ?? "",
    );
    assert.deepEqual(links, [
      "/start/#what-happens-on-commit",
      "/rules/#house-rules-migrations",
      "/rules/#no-hand-rolled-surface",
    ]);
    for (const link of links) assert.ok(liveTarget(link), link);
  });
});

describe("built home page", { skip }, () => {
  it("shows every refusal and the counts without JS", () => {
    const html = readFileSync(index, "utf8");
    const page = text(html);
    assert.match(html, /role="tablist"[^>]*hidden/, "the tablist is not hidden until JS runs");
    for (const { quote } of quotedRefusals) {
      // The template-hole quotes are source-only; the page carries the filled-in refusal below.
      if (!quote.includes("${")) assert.ok(page.includes(quote), quote);
    }
    assert.ok(page.includes(tableRefusal), tableRefusal);
    assert.doesNotMatch(html, /<article[^>]*class="[^"]*panel/, "a panel is an article");
    assert.ok(page.includes(`${readRuleRows().length} rules`), "rule count");
    assert.ok(page.includes(`${TOOLS.length} tools`), "tool count");
    assert.ok(page.includes("1 hook pre-commit: pnpm check + pnpm test"), "hook");
    for (const href of ["/start/", "/rules/", "https://github.com/JakubSzwajka/house-rules"]) {
      assert.ok(html.includes(`href="${href}"`), `nav misses ${href}`);
    }
    for (const gone of ["/guides/", "/skills/", "/start/for-agents/"]) {
      assert.ok(!html.includes(`href="${gone}`), `home still links ${gone}`);
    }
  });
});
