import { readFileSync } from "node:fs";
import { join } from "node:path";
import plugin from "@house-rules/rules";
import { layout } from "@house-rules/rules/dependency-cruiser";
import type { GeneratedPage } from "./generated-page.ts";
import { generatedPage } from "./generated-page.ts";
import { resolveLink } from "./links.ts";
import {
  demoteHeadings,
  firstHeading,
  rewriteLinks,
  withoutFirstHeading,
} from "./markdown-text.ts";
import type { RuleRow, Tool } from "./rule-rows.ts";
import { RULES_README, readRuleRows, rowsSharingDoc, TOOLS } from "./rule-rows.ts";
import { githubUrl, repoRoot } from "./site-map.ts";

const readJson = (repoPath: string): unknown =>
  JSON.parse(readFileSync(join(repoRoot, repoPath), "utf8"));
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const json = (value: unknown): string => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
const link = (repoPath: string): string => `[\`${repoPath}\`](${githubUrl(repoPath)})`;
const plain = (markdown: string): string => markdown.replaceAll("`", "");

export const embedDoc = (docPath: string, demoteBy: number): string => {
  const absolute = join(repoRoot, docPath);
  const body = withoutFirstHeading(readFileSync(absolute, "utf8"));
  const linked = rewriteLinks(body, (target) => resolveLink(absolute, target, "page"));
  return demoteHeadings(linked, demoteBy).trim();
};

const factsTable = (facts: readonly (readonly [string, string])[]): string =>
  [
    "| Field | Value |",
    "| --- | --- |",
    ...facts.map(([key, value]) => `| ${key} | ${value} |`),
  ].join("\n");

const eslintSections = (row: RuleRow): { facts: [string, string][]; sections: string[] } => {
  const meta = plugin.rules[row.id]?.meta;
  if (meta === undefined && row.id.includes("/")) {
    return {
      facts: [
        ["Rule IDs", `\`${row.id}\``],
        ["Source", link("packages/rules/src/shadcn.mjs")],
      ],
      sections: [`## In one line\n\n${row.catches}`],
    };
  }
  if (meta === undefined) {
    throw new Error(
      `${RULES_README} lists ESLint rule ${row.id}, but the plugin has no such rule.`,
    );
  }
  const messages = Object.entries(meta.messages ?? {}).map(
    ([id, text]) => `- \`${id}\`: ${text.replaceAll("\n", " ")}`,
  );
  return {
    facts: [
      ["Rule ID", `\`house-rules/${row.id}\``],
      ["Type", meta.type ?? "not set"],
      ["Autofix", meta.fixable === undefined ? "no" : meta.fixable],
      ["Source", link(`packages/rules/src/${row.id}.mjs`)],
    ],
    sections: [
      `## In one line\n\n${meta.docs?.description ?? row.catches}`,
      ...(messages.length > 0 ? [`## Messages\n\n${messages.join("\n")}`] : []),
      ...(meta.defaultOptions === undefined
        ? []
        : [`## Default options\n\n${json(meta.defaultOptions)}`]),
    ],
  };
};

const cruiserSections = (row: RuleRow): { facts: [string, string][]; sections: string[] } => {
  const rule = layout({ scope: "@hosti/" }).forbidden.find(
    (candidate) => candidate.name === row.id,
  );
  if (rule === undefined) {
    throw new Error(`${RULES_README} lists ${row.id}, but layout() has no such rule.`);
  }
  return {
    facts: [
      ["Severity", rule.severity],
      ["Kind", rule.module === undefined ? "dependency rule" : "module rule (reports the file)"],
      ["Source", link("packages/rules/src/dependency-cruiser.cjs")],
    ],
    sections: [`## As \`layout({ scope: "@hosti/" })\` builds it\n\n${json(rule)}`],
  };
};

const biomeSections = (row: RuleRow): { facts: [string, string][]; sections: string[] } => {
  const preset = asRecord(readJson("packages/rules/biome/preset.json"));
  const source: [string, string] = ["Source", link("packages/rules/biome/preset.json")];
  if (row.id === "Formatter") {
    return { facts: [source], sections: [`## Preset setting\n\n${json(preset["formatter"])}`] };
  }
  const groups = asRecord(asRecord(preset["linter"])["rules"]);
  const group = Object.keys(groups).find((name) => row.id in asRecord(groups[name]));
  if (group === undefined) {
    throw new Error(`${RULES_README} lists Biome rule ${row.id}, but the preset does not set it.`);
  }
  const setting = asRecord(groups[group])[row.id];
  const level = typeof setting === "string" ? setting : String(asRecord(setting)["level"]);
  return {
    facts: [["Biome rule", `\`${group}/${row.id}\``], ["Level", level], source],
    sections: [`## Preset setting\n\n${json({ [group]: { [row.id]: setting } })}`],
  };
};

const typescriptSections = (row: RuleRow): { facts: [string, string][]; sections: string[] } => {
  if (row.id === "Effect diagnostics") {
    const effect = asRecord(
      asRecord(readJson("packages/rules/tsconfig/effect.json"))["compilerOptions"],
    );
    const plugins = Array.isArray(effect["plugins"]) ? effect["plugins"] : [];
    return {
      facts: [["Source", link("packages/rules/tsconfig/effect.json")]],
      sections: [`## Diagnostic severities\n\n${json(asRecord(plugins[0])["diagnosticSeverity"])}`],
    };
  }
  const strict = asRecord(readJson("packages/rules/tsconfig/strict.json"))["compilerOptions"];
  return {
    facts: [["Source", link("packages/rules/tsconfig/strict.json")]],
    sections: [`## Compiler options\n\n${json(strict)}`],
  };
};

const nodeSections = (row: RuleRow): { facts: [string, string][]; sections: string[] } => {
  const stem = row.docPath.replace(/^.*\/|\.md$/g, "");
  const bins = asRecord(asRecord(readJson("packages/rules/package.json"))["bin"]);
  const named = /`(house-rules-[a-z]+)` bin/.exec(row.enableVia)?.[1];
  const bin = Object.entries(bins).find(
    ([name, path]) => name === named || path === `bin/${stem}.mjs`,
  );
  if (bin === undefined || typeof bin[1] !== "string") {
    return { facts: [], sections: [] };
  }
  return {
    facts: [
      ["Bin", `\`${bin[0]}\``],
      ["Source", link(`packages/rules/${bin[1]}`)],
    ],
    sections: [],
  };
};

const SECTIONS_BY_TOOL: Readonly<
  Record<string, (row: RuleRow) => { facts: [string, string][]; sections: string[] }>
> = {
  eslint: eslintSections,
  "dependency-cruiser": cruiserSections,
  typescript: typescriptSections,
  biome: biomeSections,
  node: nodeSections,
};

const rulePage = (row: RuleRow, rows: readonly RuleRow[]): GeneratedPage => {
  const sectionsFor = SECTIONS_BY_TOOL[row.tool.slug];
  if (sectionsFor === undefined) {
    throw new Error(`No page renderer for tool ${row.tool.name}.`);
  }
  const { facts, sections } = sectionsFor(row);
  const shared = rowsSharingDoc(rows, row.docPath).length > 1;
  const docs = shared
    ? `## Docs\n\nThis rule is one of several in the ${row.tool.name} preset. [The ${row.tool.name} page](index.md) carries the full preset docs from ${link(row.docPath)}.`
    : `## Rule docs\n\nFrom ${link(row.docPath)}.\n\n${embedDoc(row.docPath, 1)}`;
  const body = [
    factsTable([
      ["Tool", row.tool.name],
      ["Enable via", row.enableVia],
      ...facts,
      ["Docs", link(row.docPath)],
    ]),
    `## What it catches\n\n${row.catches}.`,
    ...sections,
    docs,
    `[All rules](../index.md) · [${row.tool.name} rules](index.md)`,
  ];
  return generatedPage(`rules/${row.tool.slug}/${row.slug}.md`, {
    source: RULES_README,
    title: row.id,
    description: plain(row.catches),
    order: row.order,
    body: body.join("\n\n"),
  });
};

const ruleTable = (
  rows: readonly RuleRow[],
  href: (row: RuleRow) => string,
  withTool: boolean,
): string =>
  [
    withTool ? "| Rule | Tool | Catches | Enable via |" : "| Rule | Catches | Enable via |",
    withTool ? "| --- | --- | --- | --- |" : "| --- | --- | --- |",
    ...rows.map((row) => {
      const name = `[${row.id}](${href(row)})`;
      return withTool
        ? `| ${name} | ${row.tool.name} | ${row.catches} | ${row.enableVia} |`
        : `| ${name} | ${row.catches} | ${row.enableVia} |`;
    }),
  ].join("\n");

const toolPage = (tool: Tool, rows: readonly RuleRow[], order: number): GeneratedPage => {
  const own = rows.filter((row) => row.tool.slug === tool.slug);
  const sharedDocs = [...new Set(own.map((row) => row.docPath))].filter(
    (docPath) => rowsSharingDoc(rows, docPath).length > 1,
  );
  const presetDocs = sharedDocs.map((docPath) => {
    const title = firstHeading(readFileSync(join(repoRoot, docPath), "utf8")) ?? docPath;
    return `## ${title}\n\nFrom ${link(docPath)}.\n\n${embedDoc(docPath, 1)}`;
  });
  return generatedPage(`rules/${tool.slug}/index.md`, {
    source: RULES_README,
    title: `${tool.name} rules`,
    description: `The ${own.length} checks the house plugin runs through ${tool.name}.`,
    order,
    label: "Overview",
    body: [
      ruleTable(own, (row) => `${row.slug}.md`, false),
      ...presetDocs,
      "[All rules](../index.md)",
    ].join("\n\n"),
  });
};

const indexPage = (rows: readonly RuleRow[]): GeneratedPage =>
  generatedPage("rules/index.md", {
    source: RULES_README,
    title: "All rules",
    description: `Every check in pnpm check that comes from the house plugin: ${rows.length} rules over ${TOOLS.length} tools.`,
    order: 0,
    label: "All rules",
    body: [
      `Each rule below has its own page. The list comes from the rules table in ${link(RULES_README)}, and each page adds the rule's metadata and docs from \`packages/rules\`. The [checks guide](../guides/checks.md) shows how they run.`,
      ruleTable(rows, (row) => `${row.tool.slug}/${row.slug}.md`, true),
    ].join("\n\n"),
  });

export const rulePages = (): readonly GeneratedPage[] => {
  const rows = readRuleRows();
  return [
    indexPage(rows),
    ...TOOLS.map((tool, index) => toolPage(tool, rows, index + 1)),
    ...rows.map((row) => rulePage(row, rows)),
  ];
};
