import { COLOR_KEYWORDS, nearestToken, parseColor } from "./colors.mjs";
import { declarationValue, locOf, scanCssValue } from "./css-values.mjs";
import { readTokens } from "./design-tokens.mjs";
import { matchesAnyGlob } from "./file-globs.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

export const DEFAULT_ALLOWED_COLOR_VALUES = [
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
];

// These properties take author-chosen names, so `tan` or `navy` there is a name, not a colour.
const CUSTOM_IDENT_PROPERTY =
  /^(?:-[a-z]+-)?(?:animation(?:-name)?|font(?:-family)?|grid(?:-.+)?|counter-.+|container(?:-name)?|view-transition-(?:name|class)|list-style(?:-type)?|transition(?:-property)?|will-change|anchor-name|position-anchor|timeline-scope|(?:scroll|view)-timeline(?:-name)?|page)$/i;

function normalized(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function isColorItem(item, property) {
  if (item.inColorFunction) return false;
  if (item.type === "hex") return true;
  if (item.type === "color-function") return !item.hasVar;
  if (item.type !== "identifier") return false;
  return COLOR_KEYWORDS.has(item.text.toLowerCase()) && !CUSTOM_IDENT_PROPERTY.test(property);
}

export const designNoRawColorRule = {
  meta: {
    type: "suggestion",
    docs: {
      url: ruleDocsUrl("design-no-raw-color"),
      description: "Disallow raw colours in CSS declaration values outside the design-token files.",
    },
    messages: {
      rawColor: 'Raw colour "{{color}}". Use a design token.',
      rawColorNearest: 'Raw colour "{{color}}". Use a design token; the nearest is var({{token}}).',
      rawColorExact: 'Raw colour "{{color}}" is the value of var({{token}}). Use the token.',
    },
    schema: [
      {
        type: "object",
        properties: {
          tokenFiles: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          allowValues: { type: "array", items: { type: "string" }, uniqueItems: true },
          allowIn: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          suggestNearest: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [
      {
        tokenFiles: [],
        allowValues: DEFAULT_ALLOWED_COLOR_VALUES,
        allowIn: [],
        suggestNearest: true,
      },
    ],
  },

  create(context) {
    const [{ tokenFiles, allowValues, allowIn, suggestNearest }] = context.options;
    const filename = context.physicalFilename ?? context.filename;
    if (matchesAnyGlob(filename, context.cwd, allowIn)) return {};
    const tokens = readTokens(context.cwd, tokenFiles);
    const inTokenFile = tokens.isTokenFile(filename);
    const allowed = new Set(allowValues.map(normalized));
    const { sourceCode } = context;

    function report(item, offset) {
      const loc = locOf(sourceCode, offset + item.start, offset + item.end);
      const color = item.text.replace(/\s+/g, " ");
      const parsed = suggestNearest ? parseColor(item.text) : null;
      const nearest = parsed ? nearestToken(parsed, tokens.palette) : null;
      if (!nearest) {
        context.report({ loc, messageId: "rawColor", data: { color } });
        return;
      }
      const exact = nearest.distance < 1e-4 && Math.abs(nearest.alpha - parsed.alpha) < 1e-3;
      context.report({
        loc,
        messageId: exact ? "rawColorExact" : "rawColorNearest",
        data: { color, token: nearest.name },
      });
    }

    return {
      Declaration(node) {
        if (inTokenFile && node.property.startsWith("--")) return;
        const value = declarationValue(sourceCode, node);
        if (!value) return;
        for (const item of scanCssValue(value.text)) {
          if (isColorItem(item, node.property) && !allowed.has(normalized(item.text)))
            report(item, value.start);
        }
      },
    };
  },
};
