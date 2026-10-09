import plugin, { ruleAnchor } from "@house-rules/rules";
import type { GeneratedPage } from "./generated-page.ts";
import { generatedPage } from "./generated-page.ts";
import type { RuleRow } from "./rule-rows.ts";
import { RULES_README, readRuleRows, TOOLS } from "./rule-rows.ts";
import { githubUrl } from "./site-map.ts";

type Rules = typeof plugin.rules;

export const SHADCN_ROW = "shadcn/*";

export { ruleAnchor };

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

const isCode = (word: string): boolean => /[(*@]|--|\w\.\w/.test(word);

const descriptionMarkdown = (text: string): string =>
  text
    .split(" ")
    .map((word) => {
      const [, core = word, tail = ""] = /^(.*?)([.,:;]*)$/.exec(word) ?? [];
      return isCode(core) ? `\`${core}\`${tail}` : word.replace(/[\\`*_[\]<>|]/g, "\\$&");
    })
    .join(" ");

export const refusalFor = (row: RuleRow, rules: Rules = plugin.rules): string => {
  if (row.tool.slug !== "eslint") {
    return sentence(row.catches);
  }
  const description = rules[row.id]?.meta.docs?.description;
  if (description !== undefined) {
    const first = /^.*?[.!?](?=\s|$)/.exec(description)?.[0] ?? description;
    return descriptionMarkdown(sentence(first));
  }
  if (row.id === SHADCN_ROW) {
    // its rules come from @shadcn/lint, so the plugin has no meta for them
    return sentence(row.catches);
  }
  throw new Error(`${RULES_README} lists ESLint rule ${row.id}, but the plugin has no such rule.`);
};

const ruleCell = (row: RuleRow): string => {
  const anchor = ruleAnchor(row.id);
  return `<span id="${anchor}"></span>[\`${row.id}\`](#${anchor})`;
};

const sourceCell = (row: RuleRow): string => `[docs](${githubUrl(row.docPath)}${row.docHash})`;

export const rulesTable = (rows: readonly RuleRow[], rules: Rules = plugin.rules): string =>
  [
    "| Rule | Tool | What it refuses | Source |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${ruleCell(row)} | ${row.tool.name} | ${refusalFor(row, rules)} | ${sourceCell(row)} |`,
    ),
  ].join("\n");

export const rulesPage = (): GeneratedPage => {
  const rows = readRuleRows();
  const anchors = rows.map((row) => ruleAnchor(row.id));
  const repeated = anchors.find((anchor, at) => anchors.indexOf(anchor) !== at);
  if (repeated !== undefined) {
    throw new Error(`${RULES_README}: two rules share the anchor #${repeated}.`);
  }
  return generatedPage("rules/index.md", {
    source: RULES_README,
    title: "Rules",
    description: `Every check the house plugin adds to pnpm check: ${rows.length} rules over ${TOOLS.length} tools.`,
    order: 0,
    body: [
      `These are the checks the house plugin adds to \`pnpm check\`. The pre-commit hook runs \`pnpm check\` before each commit. The list comes from the rules table in [\`${RULES_README}\`](${githubUrl(RULES_README)}#rules-and-checks). The docs link in each row opens that rule's docs on GitHub.`,
      rulesTable(rows),
    ].join("\n\n"),
  });
};
