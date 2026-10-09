import { declarationValue, locOf, scanCssValue } from "./css-values.mjs";
import { readTokens } from "./design-tokens.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

function allowMatcher(entries) {
  const names = new Set();
  const patterns = [];
  for (const entry of entries) {
    const pattern = /^\/(.+)\/([a-z]*)$/.exec(entry);
    if (pattern) patterns.push(new RegExp(pattern[1], pattern[2]));
    else names.add(entry);
  }
  return (name) => names.has(name) || patterns.some((regex) => regex.test(name));
}

export const designNoUnknownTokenRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("design-no-unknown-token"),
      description:
        "Require every var(--name) to resolve to a custom property defined in a token file or in the same file.",
    },
    messages: {
      unknown: "var({{name}}) has no definition in the token files or in this file.",
    },
    schema: [
      {
        type: "object",
        properties: {
          tokenFiles: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          allow: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ tokenFiles: [], allow: [] }],
  },

  create(context) {
    const [{ tokenFiles, allow }] = context.options;
    const tokens = readTokens(context.cwd, tokenFiles);
    const allowed = allowMatcher(allow);
    const { sourceCode } = context;
    const local = new Set();
    const references = [];

    return {
      Atrule(node) {
        if (node.name.toLowerCase() !== "property" || !node.prelude) return;
        const name = sourceCode.getText(node.prelude).trim();
        if (name.startsWith("--")) local.add(name);
      },
      Declaration(node) {
        if (node.property.startsWith("--")) local.add(node.property);
        const value = declarationValue(sourceCode, node);
        if (!value) return;
        for (const item of scanCssValue(value.text)) {
          if (item.type === "var")
            references.push({
              name: item.name,
              start: value.start + item.start,
              end: value.start + item.end,
            });
        }
      },
      "StyleSheet:exit"() {
        for (const { name, start, end } of references) {
          if (tokens.names.has(name) || local.has(name) || allowed(name)) continue;
          context.report({
            loc: locOf(sourceCode, start, end),
            messageId: "unknown",
            data: { name },
          });
        }
      },
    };
  },
};
