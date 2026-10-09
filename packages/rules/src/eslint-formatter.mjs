import { ESLint } from "eslint";
import { RULES_PAGE_URL } from "./rule-docs.mjs";

// Only rules whose docs.url points at our rules page get a line; third-party rules are skipped
const ownedUrl = (meta) => {
  const url = meta?.docs?.url;
  return typeof url === "string" && url.startsWith(RULES_PAGE_URL) ? url : undefined;
};

export default async function houseRulesFormatter(results, context) {
  const stylish = await (await new ESLint().loadFormatter("stylish")).format(results, context);
  const rulesMeta = context?.rulesMeta ?? {};
  const seen = new Set();
  const lines = [];
  for (const result of results) {
    for (const { ruleId } of result.messages) {
      if (!ruleId || seen.has(ruleId)) continue;
      seen.add(ruleId);
      const url = ownedUrl(rulesMeta[ruleId]);
      if (url) lines.push(`See ${url}  (${ruleId})`);
    }
  }
  return lines.length === 0 ? stylish : `${stylish}\n${lines.join("\n")}\n`;
}
