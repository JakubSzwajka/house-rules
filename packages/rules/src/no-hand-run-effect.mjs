import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";

const EFFECT_RUN = /^run[A-Z]/u;
const MODULES = [
  { name: "Effect", module: /^effect\/Effect$/u, banned: (name) => EFFECT_RUN.test(name) },
  {
    name: "ManagedRuntime",
    module: /^effect\/ManagedRuntime$/u,
    banned: (name) => name === "make",
  },
];
const BARREL = /^effect$/u;
// What `import * as All from "effect"` names: a namespace that holds the modules above.
const BARREL_NAMESPACE = Symbol("effect barrel");
const MAX_ALIAS_DEPTH = 8;

function moduleOf(binding) {
  if (binding === null) return undefined;
  if (binding.imported === "*" || binding.imported === "default") {
    const entry = MODULES.find((candidate) => candidate.module.test(binding.source));
    if (entry) return entry;
    return binding.imported === "*" && BARREL.test(binding.source) ? BARREL_NAMESPACE : undefined;
  }
  return BARREL.test(binding.source)
    ? MODULES.find((entry) => entry.name === binding.imported)
    : undefined;
}

function patternKey(property) {
  if (property.type !== "Property") return undefined;
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
}

function patternTarget(value) {
  return value.type === "AssignmentPattern" ? value.left : value;
}

export const noHandRunEffectRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid running an Effect by hand in a test: no Effect.run* and no ManagedRuntime.make. Tests run Effects through @effect/vitest.",
    },
    messages: {
      handRun:
        "{{call}} runs an Effect by hand. Write the test with it.effect or it.layer from @effect/vitest, and provide services with a Layer.",
    },
    schema: [],
  },

  create(context) {
    const { sourceCode } = context;
    const report = (node, entry, name) =>
      context.report({ node, messageId: "handRun", data: { call: `${entry.name}.${name}` } });

    // The Effect module an expression names, or the barrel namespace: an import, `E.Effect`,
    // or a `const` alias of either. A shadowing local binding is not mistaken for the import.
    function resolve(expression, depth = 0) {
      const node = unwrapExpression(expression);
      if (depth > MAX_ALIAS_DEPTH) return undefined;
      if (node.type === "MemberExpression") {
        const name = staticPropertyName(node);
        return resolve(node.object, depth + 1) === BARREL_NAMESPACE
          ? MODULES.find((entry) => entry.name === name)
          : undefined;
      }
      if (node.type !== "Identifier") return undefined;
      let scope = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          const definition = variable.defs[0];
          if (definition?.type === "ImportBinding") return moduleOf(importOf(node, sourceCode));
          const declarator = definition?.node;
          if (
            definition?.type === "Variable" &&
            definition.parent.kind === "const" &&
            declarator.id.type === "Identifier" &&
            declarator.init
          ) {
            return resolve(declarator.init, depth + 1);
          }
          return undefined;
        }
        scope = scope.upper;
      }
      return undefined;
    }

    // `const { runPromise: run = fallback } = Effect` and `const { Effect: { runPromise } } = All`.
    function checkPattern(pattern, target) {
      if (target === undefined || pattern.type !== "ObjectPattern") return;
      for (const property of pattern.properties) {
        const name = patternKey(property);
        if (name === undefined) continue;
        if (target === BARREL_NAMESPACE) {
          const entry = MODULES.find((candidate) => candidate.name === name);
          checkPattern(patternTarget(property.value), entry);
        } else if (target.banned(name)) {
          report(property, target, name);
        }
      }
    }

    return {
      // A reference counts, not only a call: `pipe(effect, Effect.runPromise)` runs it too.
      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (name === undefined) return;
        const entry = resolve(node.object);
        if (entry && entry !== BARREL_NAMESPACE && entry.banned(name)) report(node, entry, name);
      },
      VariableDeclarator(node) {
        if (node.init) checkPattern(node.id, resolve(node.init));
      },
      AssignmentExpression(node) {
        if (node.operator === "=") checkPattern(node.left, resolve(node.right));
      },
      ImportSpecifier(node) {
        const declaration = node.parent;
        if (declaration.importKind === "type" || node.importKind === "type") return;
        const name = node.imported.name ?? node.imported.value;
        const entry = MODULES.find((candidate) => candidate.module.test(declaration.source.value));
        if (entry?.banned(name)) report(node, entry, name);
      },
      // `export { runPromise } from "effect/Effect"` hands the runner to whoever imports the test file.
      ExportSpecifier(node) {
        const declaration = node.parent;
        if (!declaration.source) return;
        if (declaration.exportKind === "type" || node.exportKind === "type") return;
        const name = node.local.name ?? node.local.value;
        const entry = MODULES.find((candidate) => candidate.module.test(declaration.source.value));
        if (entry?.banned(name)) report(node, entry, name);
      },
    };
  },
};
