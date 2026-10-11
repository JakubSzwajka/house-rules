import { matchesAnyGlob } from "./file-globs.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

// A colour must follow a delimiter. Letters, digits, `&`, `/`, `.` or `?` before `#` mean an HTML entity
// (`&#8599;`) or a URL fragment (`page#cafe`), not a colour.
const COLOR =
  /(?<=^|[\s"'`:(,=;{[>|])(?:#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/gi;
// After a match's own delimiter: a query value (`?q=#fff`) or a CSS attribute selector value (`[data-id="#add"]`).
const QUERY_VALUE = /[?&][\w.%-]*=$/;
const ATTRIBUTE_VALUE = /\[\s*[\w-]+\s*[~|^$*]?=\s*["']?$/;
const ABSOLUTE_URL = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'`<>()]*/gi;
const URL_KEYS = new Set(["href", "to", "src", "action", "xlinkHref", "xlink:href"]);
const COLOR_UTILITY =
  "(?:bg|text|border(?:-[xytrblse])?|divide|ring|ring-offset|outline|fill|stroke|decoration|from|via|to|accent|caret|placeholder|shadow|inset-shadow|drop-shadow|text-shadow)";
const OPACITY = "(?:/(?:\\d{1,3}|\\[[^\\]]+\\]|\\([^)]+\\)))?";

// `bg-white` → `white` for a Tailwind colour utility, after its variants (`hover:`) and `!` modifier.
function classColorMatcher(colors) {
  if (!colors.length) return null;
  const utility = new RegExp(`^${COLOR_UTILITY}-(${colors.join("|")})${OPACITY}$`, "i");
  return (token) => {
    let depth = 0;
    let lastColon = -1;
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] === "[" || token[index] === "(") depth += 1;
      else if (token[index] === "]" || token[index] === ")") depth -= 1;
      else if (token[index] === ":" && depth === 0) lastColon = index;
    }
    return utility.exec(token.slice(lastColon + 1).replace(/^!|!$/g, ""))?.[1] ?? null;
  };
}

function closingParen(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")" && --depth === 0) return index + 1;
  }
  return text.length;
}

function varFallbackRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(/var\(\s*--[^\s,()]*\s*,/g)) {
    const end = closingParen(text, match.index + 3);
    ranges.push([match.index + match[0].length, end]);
  }
  return ranges;
}

function urlRanges(text) {
  return [...text.matchAll(ABSOLUTE_URL)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

function isSelectorOrQueryValue(text, start) {
  const before = text.slice(Math.max(0, start - 64), start);
  return QUERY_VALUE.test(before) || ATTRIBUTE_VALUE.test(before);
}

export function findColorLiterals(text, { skipVarFallback = true } = {}) {
  const skipped = [...(skipVarFallback ? varFallbackRanges(text) : []), ...urlRanges(text)];
  const found = [];
  for (const match of text.matchAll(COLOR)) {
    const start = match.index;
    if (skipped.some(([from, to]) => start >= from && start < to)) continue;
    if (match[0].startsWith("#")) {
      if (isSelectorOrQueryValue(text, start)) continue;
      found.push({ start, end: start + match[0].length });
      continue;
    }
    const end = closingParen(text, start + match[0].length - 1);
    // rgb(var(--ink-rgb) / 0.5) builds on a token, and prose like "color(s)" has no channel numbers.
    const call = text.slice(start, end);
    if (/var\(/.test(call) || !/\d/.test(call)) continue;
    found.push({ start, end });
  }
  return found;
}

function keyName(node) {
  if (!node) return null;
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXNamespacedName") return `${node.namespace.name}:${node.name.name}`;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value);
  return null;
}

function isUrlValue(node) {
  const parent = node.parent;
  if (parent?.type === "JSXAttribute") return URL_KEYS.has(keyName(parent.name));
  if (parent?.type === "Property" && parent.value === node)
    return URL_KEYS.has(keyName(parent.key));
  return false;
}

export const designNoRawColorLiteralRule = {
  meta: {
    type: "suggestion",
    docs: {
      url: ruleDocsUrl("design-no-raw-color-literal"),
      description:
        "Disallow raw hex colours and colour functions inside JavaScript and TypeScript strings.",
    },
    messages: {
      rawColor:
        'Raw colour "{{color}}" in a string. Use a design token, such as var(--name) or a theme constant.',
      rawColorClass:
        'Class "{{className}}" uses the raw colour {{color}}. Use a colour class built on a design token.',
    },
    schema: [
      {
        type: "object",
        properties: {
          skipVarFallback: { type: "boolean" },
          allowIn: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          classColors: {
            type: "array",
            items: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ skipVarFallback: true, allowIn: [], classColors: [] }],
  },

  create(context) {
    const [{ skipVarFallback, allowIn, classColors }] = context.options;
    const filename = context.physicalFilename ?? context.filename;
    if (matchesAnyGlob(filename, context.cwd, allowIn)) return {};
    const { sourceCode } = context;
    const classColor = classColorMatcher(classColors);

    function report(offset, start, end, messageId, data) {
      context.report({
        loc: {
          start: sourceCode.getLocFromIndex(offset + start),
          end: sourceCode.getLocFromIndex(offset + end),
        },
        messageId,
        data,
      });
    }

    function checkClasses(text, offset) {
      for (const match of text.matchAll(/[^\s"'`]+/g)) {
        const color = classColor(match[0]);
        if (color) {
          report(offset, match.index, match.index + match[0].length, "rawColorClass", {
            className: match[0],
            color,
          });
        }
      }
    }

    function check(node) {
      const text = sourceCode.getText(node);
      const offset = node.range[0];
      for (const { start, end } of findColorLiterals(text, { skipVarFallback })) {
        report(offset, start, end, "rawColor", {
          color: text.slice(start, end).replace(/\s+/g, " "),
        });
      }
      if (classColor) checkClasses(text, offset);
    }

    return {
      Literal(node) {
        if (typeof node.value === "string" && !isUrlValue(node)) check(node);
      },
      TemplateElement: check,
    };
  },
};
