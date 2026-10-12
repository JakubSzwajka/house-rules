import { ruleDocsUrl } from "./rule-docs.mjs";

// A literal, or a template with no expressions: the only specifiers an import graph can follow.
const isLiteralSpecifier = (node) =>
  (node?.type === "Literal" && typeof node.value === "string") ||
  (node?.type === "TemplateLiteral" && node.expressions.length === 0);

export const noComputedImportRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("no-computed-import"),
      description:
        "Forbid an import() or require() whose specifier is computed in a package's source, so every import stays visible to the graph checks, contract-entry-is-browser-safe among them.",
    },
    messages: {
      computed:
        "This {{call}} computes its specifier, so no check can see what it loads. Import by a string literal, or move the choice into a table of literal imports.",
    },
    schema: [],
  },

  create(context) {
    const report = (node, call) => context.report({ node, messageId: "computed", data: { call } });
    return {
      ImportExpression(node) {
        if (!isLiteralSpecifier(node.source)) report(node, "import()");
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "Identifier" || callee.name !== "require") return;
        if (!isLiteralSpecifier(node.arguments[0])) report(node, "require()");
      },
    };
  },
};
