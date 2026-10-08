import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./site-map.ts";

export const RULES_README = "packages/rules/README.md";

export interface Tool {
  readonly name: string;
  readonly slug: string;
}

export const TOOLS: readonly Tool[] = [
  { name: "ESLint", slug: "eslint" },
  { name: "Dependency Cruiser", slug: "dependency-cruiser" },
  { name: "TypeScript", slug: "typescript" },
  { name: "Biome", slug: "biome" },
  { name: "Node", slug: "node" },
];

export interface RuleRow {
  readonly id: string;
  readonly slug: string;
  readonly catches: string;
  readonly tool: Tool;
  readonly enableVia: string;
  readonly docPath: string;
  readonly order: number;
}

const kebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

const toolNamed = (name: string): Tool => {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`${RULES_README}: unknown tool "${name}" in the rules table.`);
  }
  return tool;
};

const docTarget = (cell: string): string => {
  const target = /\]\(([^)]+)\)/.exec(cell)?.[1] ?? /^`([^`]+\.md)`$/.exec(cell)?.[1];
  if (target === undefined) {
    throw new Error(`${RULES_README}: no docs link in "${cell}".`);
  }
  return `packages/rules/${target.replace(/#.*$/, "")}`;
};

export const readRuleRows = (): readonly RuleRow[] => {
  const readme = readFileSync(join(repoRoot, RULES_README), "utf8");
  const section = readme.split(/^## Rules and checks$/m)[1]?.split(/^## /m)[0];
  if (section === undefined) {
    throw new Error(`${RULES_README}: no "## Rules and checks" section.`);
  }
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  return lines.slice(2).map((line, order) => {
    const [name, catches, tool, enableVia, docs] = cells(line);
    if (
      name === undefined ||
      catches === undefined ||
      tool === undefined ||
      enableVia === undefined ||
      docs === undefined
    ) {
      throw new Error(`${RULES_README}: a rules table row needs five cells: ${line}`);
    }
    const id = name.replace(/ \(.*\)$/, "").replaceAll("`", "");
    return {
      id,
      slug: kebab(id),
      catches,
      tool: toolNamed(tool),
      enableVia,
      docPath: docTarget(docs),
      order: order + 1,
    };
  });
};

export const rowsSharingDoc = (rows: readonly RuleRow[], docPath: string): readonly RuleRow[] =>
  rows.filter((row) => row.docPath === docPath);
