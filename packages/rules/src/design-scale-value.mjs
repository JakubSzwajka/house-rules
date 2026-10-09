import {
  declarationValue,
  locOf,
  scanCssValue,
  splitCommaList,
  splitComponents,
} from "./css-values.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

function normalized(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function compile(scales) {
  return scales.map(({ property, allowed = [], requireVar }) => ({
    property: new RegExp(property),
    allowed: new Set(allowed.map(normalized)),
    allowedText: allowed.join(", "),
    requireVar,
  }));
}

function usesVar(text, prefix) {
  return scanCssValue(text).some(
    (item) => item.type === "var" && (prefix === undefined || item.name.startsWith(prefix)),
  );
}

// With requireVar, each comma-separated layer (one transition, one shadow) must use the token.
// Without it, each space-, slash- or comma-separated component must be on the scale or come from any var().
function offScale(value, scale) {
  if (scale.allowed.has(normalized(value)) || CSS_WIDE_KEYWORDS.has(normalized(value))) return [];
  if (scale.requireVar !== undefined) {
    return splitCommaList(value).filter(
      (layer) => !scale.allowed.has(normalized(layer)) && !usesVar(layer, scale.requireVar),
    );
  }
  return splitComponents(value).filter(
    (part) => !scale.allowed.has(normalized(part)) && !usesVar(part),
  );
}

export const designScaleValueRule = {
  meta: {
    type: "suggestion",
    docs: {
      url: ruleDocsUrl("design-scale-value"),
      description:
        "Require values of chosen properties to come from a fixed scale or from a token variable.",
    },
    messages: {
      offScale:
        '{{property}} "{{value}}" has values off the scale: {{parts}}. Allowed: {{allowed}}.',
      needsVar: '{{property}} "{{value}}": every layer must use var({{prefix}}…).',
      needsVarOrScale:
        '{{property}} "{{value}}": every layer must use var({{prefix}}…) or be one of: {{allowed}}.',
    },
    schema: [
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            property: { type: "string", minLength: 1 },
            allowed: { type: "array", items: { type: "string" }, uniqueItems: true },
            requireVar: { type: "string", pattern: "^--" },
          },
          required: ["property"],
          anyOf: [{ required: ["allowed"] }, { required: ["requireVar"] }],
          additionalProperties: false,
        },
      },
    ],
    defaultOptions: [[]],
  },

  create(context) {
    const [scales] = context.options;
    if (!scales.length) return {};
    const compiled = compile(scales);
    const { sourceCode } = context;

    return {
      Declaration(node) {
        if (node.property.startsWith("--")) return;
        const scale = compiled.find(({ property }) => property.test(node.property));
        if (!scale) return;
        const value = declarationValue(sourceCode, node);
        if (!value) return;
        const failing = offScale(value.text, scale);
        if (!failing.length) return;
        const messageId =
          scale.requireVar === undefined
            ? "offScale"
            : scale.allowed.size
              ? "needsVarOrScale"
              : "needsVar";
        context.report({
          loc: locOf(sourceCode, value.start, value.start + value.text.length),
          messageId,
          data: {
            property: node.property,
            value: value.text.trim().replace(/\s+/g, " "),
            parts: [...new Set(failing)].join(", "),
            allowed: scale.allowedText,
            prefix: scale.requireVar,
          },
        });
      },
    };
  },
};
