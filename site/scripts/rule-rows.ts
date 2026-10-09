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
  readonly catches: string;
  readonly tool: Tool;
  readonly enableVia: string;
  readonly docPath: string;
  readonly docHash: string;
}

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

const docTarget = (cell: string): { readonly docPath: string; readonly docHash: string } => {
  const target = /\]\(([^)]+)\)/.exec(cell)?.[1] ?? /^`([^`]+\.md)`$/.exec(cell)?.[1];
  if (target === undefined) {
    throw new Error(`${RULES_README}: no docs link in "${cell}".`);
  }
  const hash = target.indexOf("#");
  return hash === -1
    ? { docPath: `packages/rules/${target}`, docHash: "" }
    : { docPath: `packages/rules/${target.slice(0, hash)}`, docHash: target.slice(hash) };
};

export const readRuleRows = (): readonly RuleRow[] => {
  const readme = readFileSync(join(repoRoot, RULES_README), "utf8");
  const section = readme.split(/^## Rules and checks$/m)[1]?.split(/^## /m)[0];
  if (section === undefined) {
    throw new Error(`${RULES_README}: no "## Rules and checks" section.`);
  }
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  return lines.slice(2).map((line) => {
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
    return {
      id: name.replace(/ \(.*\)$/, "").replaceAll("`", ""),
      catches,
      tool: toolNamed(tool),
      enableVia,
      ...docTarget(docs),
    };
  });
};
