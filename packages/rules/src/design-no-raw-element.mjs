import { componentIndex, componentName } from "./design-components.mjs";
import { matchesAnyGlob } from "./file-globs.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

// Element → the component files that replace it, as shadcn/ui names them. Each counts only when the
// component folder holds the file, so an app without a Table gets no report for <table>.
export const DEFAULT_ELEMENTS = {
  button: "button",
  input: { component: "input", unless: { type: ["hidden"] } },
  textarea: "textarea",
  select: ["native-select", "select"],
  table: "table",
  dialog: "dialog",
};
export const DEFAULT_COMPONENTS = ["**/components/ui/**"];

const names = { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true };
const nameOrNames = {
  anyOf: [
    { type: "string", minLength: 1 },
    { ...names, minItems: 1 },
  ],
};
const entrySchema = {
  anyOf: [
    { const: false },
    nameOrNames,
    {
      type: "object",
      properties: {
        component: nameOrNames,
        use: { type: "string", minLength: 1 },
        from: { type: "string", minLength: 1 },
        unless: { type: "object", additionalProperties: names },
      },
      additionalProperties: false,
      oneOf: [{ required: ["component"] }, { required: ["use"] }],
    },
  ],
};

function normalizeEntry(entry) {
  if (entry === false) return null;
  if (typeof entry === "string" || Array.isArray(entry)) return { component: [entry].flat() };
  return {
    ...(entry.component ? { component: [entry.component].flat() } : {}),
    ...(entry.use ? { use: entry.use, from: entry.from } : {}),
    unless: entry.unless ?? {},
  };
}

function staticValue(attribute) {
  const { value } = attribute;
  if (value?.type === "Literal") return typeof value.value === "string" ? value.value : null;
  if (value?.type !== "JSXExpressionContainer") return null;
  const { expression } = value;
  if (expression.type === "Literal" && typeof expression.value === "string")
    return expression.value;
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0)
    return expression.quasis[0].value.cooked;
  return null;
}

function isExempt(node, unless = {}) {
  return node.attributes.some(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      unless[attribute.name.name]?.includes(staticValue(attribute)),
  );
}

export const designNoRawElementRule = {
  meta: {
    type: "suggestion",
    docs: {
      url: ruleDocsUrl("design-no-raw-element"),
      description:
        "Disallow a raw JSX element, such as <button>, where the design system's component folder has a component for it.",
    },
    messages: {
      component: "Use <{{component}}> from {{file}} instead of a raw <{{element}}>.",
      mapped: "Use <{{component}}>{{from}} instead of a raw <{{element}}>.",
    },
    schema: [
      {
        type: "object",
        properties: {
          components: names,
          elements: {
            type: "object",
            propertyNames: { pattern: "^[a-z][a-z0-9]*$" },
            additionalProperties: entrySchema,
          },
          allow: names,
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ components: DEFAULT_COMPONENTS, elements: {}, allow: [] }],
  },

  create(context) {
    const [{ components, elements, allow }] = context.options;
    const filename = context.physicalFilename ?? context.filename;
    if (matchesAnyGlob(filename, context.cwd, [...allow, ...components])) return {};
    const map = new Map();
    for (const [element, entry] of Object.entries({ ...DEFAULT_ELEMENTS, ...elements })) {
      const normalized = normalizeEntry(entry);
      if (normalized) map.set(element, normalized);
    }
    if (!map.size) return {};
    let index;
    const folder = () => {
      index ??= componentIndex(context.cwd, components);
      return index;
    };

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const element = node.name.name;
        const entry = map.get(element);
        if (!entry || isExempt(node, entry.unless)) return;
        if (entry.use) {
          context.report({
            node: node.name,
            messageId: "mapped",
            data: { element, component: entry.use, from: entry.from ? ` from ${entry.from}` : "" },
          });
          return;
        }
        const found = entry.component.find((name) => folder().has(name));
        if (!found) return;
        context.report({
          node: node.name,
          messageId: "component",
          data: { element, component: componentName(found), file: folder().get(found) },
        });
      },
    };
  },
};
