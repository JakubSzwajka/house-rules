import { createRequire } from "node:module";
import path from "node:path";
import { ruleDocsUrl } from "./rule-docs.mjs";

// A literal, or a template with no expressions: the only specifiers an import graph can follow.
const isLiteralSpecifier = (node) =>
  (node?.type === "Literal" && typeof node.value === "string") ||
  (node?.type === "TemplateLiteral" && node.expressions.length === 0);
const ENCODING_BARREL =
  /(?:^effect\/(?:dist\/|)|(?:^|\/)node_modules\/effect\/dist\/)encoding\/index(?:[.]js|)$/u;

export const noComputedImportRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("no-computed-import"),
      description:
        "Forbid an import() or require() whose specifier is computed in production package or app source, so every import stays visible to the graph checks, contract-entry-is-browser-safe among them.",
    },
    messages: {
      computed:
        "This {{call}} computes its specifier, so no check can see what it loads. Import by a string literal, or move the choice into a table of literal imports.",
      encoding: 'Import the Effect encoding barrel only through the public "effect/encoding" door.',
    },
    schema: [],
  },

  create(context) {
    const report = (node, call) => context.report({ node, messageId: "computed", data: { call } });
    const resolve = createRequire(path.resolve(context.cwd, context.filename)).resolve;
    // The graph sees resolved filenames, not public specifiers. Do not let a relative path or alias
    // borrow the encoding barrel's trust. Other encoding files remain outside the graph's allowlist.
    const checkEncoding = (node, source) => {
      if (!isLiteralSpecifier(source)) return;
      const value = source.type === "Literal" ? source.value : source.quasis[0].value.cooked;
      if (value === "effect/encoding") return;
      const normalized = path.posix.normalize(value);
      const specifier = value.startsWith(".") ? `./${normalized}` : normalized;
      let target = value;
      try {
        target = resolve(value);
      } catch {
        // Unresolved private/deep specifiers still need the raw-path check below.
      }
      if ([specifier, target].some((candidate) => ENCODING_BARREL.test(candidate)))
        context.report({ node, messageId: "encoding" });
    };
    return {
      ImportDeclaration(node) {
        checkEncoding(node, node.source);
      },
      ExportNamedDeclaration(node) {
        checkEncoding(node, node.source);
      },
      ExportAllDeclaration(node) {
        checkEncoding(node, node.source);
      },
      ImportExpression(node) {
        if (!isLiteralSpecifier(node.source)) report(node, "import()");
        else checkEncoding(node, node.source);
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "Identifier" || callee.name !== "require") return;
        if (!isLiteralSpecifier(node.arguments[0])) report(node, "require()");
        else checkEncoding(node, node.arguments[0]);
      },
    };
  },
};
