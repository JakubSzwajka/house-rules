import { staticPropertyName, unwrapExpression } from "./import-bindings.mjs";

export const sourceDefinitions = (scopes) => {
  const definitions = new Map();
  return (file, node) => {
    if (!definitions.has(file))
      definitions.set(
        file,
        new Map(
          scopes
            .get(file)
            ?.scopes.flatMap((scope) =>
              scope.references.map((reference) => [
                reference.identifier,
                reference.resolved?.defs[0],
              ]),
            ),
        ),
      );
    return definitions.get(file).get(node);
  };
};

export const variableValue = (def, node) => {
  const initial = def?.node?.init;
  if (def?.type !== "Variable" || def.node.id.type !== "ObjectPattern") return initial;
  const property = def.node.id.properties.find(
    (item) =>
      item.type === "Property" && item.value.type === "Identifier" && item.value.name === node.name,
  );
  return property
    ? {
        type: "MemberExpression",
        object: initial,
        property: property.key,
        computed: property.computed,
      }
    : initial;
};

export const requireIdentity = (resolve, definition, load) => {
  const globalName = (file, expression, name, seen = new Set()) => {
    const node = unwrapExpression(expression);
    if (!node || seen.has(node)) return false;
    load(file);
    const next = new Set([...seen, node]);
    const def = node.type === "Identifier" && definition(file, node);
    if (node.type === "Identifier" && node.name === name && !def) return true;
    return def?.type === "Variable" && globalName(file, variableValue(def, node), name, next);
  };
  const builtinFactory = (file, expression) => {
    const found = resolve(file, expression);
    const node = found?.node ?? unwrapExpression(expression);
    return (
      node?.type === "MemberExpression" &&
      staticPropertyName(node) === "getBuiltinModule" &&
      globalName(found?.file ?? file, node.object, "process")
    );
  };
  const mainModule = (file, expression, seen) => {
    const found = resolve(file, expression);
    const node = found?.node ?? unwrapExpression(expression);
    return (
      node?.type === "MemberExpression" &&
      staticPropertyName(node) === "main" &&
      isRequire(found?.file ?? file, node.object, seen)
    );
  };
  const loaderBinding = (file, expression, seen) => {
    const found = resolve(file, expression);
    if (found?.source) return found;
    const node = found?.node ?? unwrapExpression(expression);
    const from = found?.file ?? file;
    if (!node || seen.has(node)) return undefined;
    const next = new Set([...seen, node]);
    if (node.type === "AwaitExpression") return loaderBinding(from, node.argument, next);
    if (node.type === "MemberExpression") {
      const owner = loaderBinding(from, node.object, next);
      return owner?.imported === "*" ||
        (["node:module", "module"].includes(owner?.source) && owner?.imported === "Module")
        ? { ...owner, imported: staticPropertyName(node) }
        : undefined;
    }
    const specifier =
      node.type === "ImportExpression"
        ? node.source
        : node.type === "CallExpression" &&
            (isRequire(from, node.callee, next) || builtinFactory(from, node.callee))
          ? node.arguments[0]
          : undefined;
    const source =
      specifier?.type === "Literal"
        ? specifier.value
        : specifier?.type === "TemplateLiteral" && specifier.expressions.length === 0
          ? specifier.quasis[0].value.cooked
          : undefined;
    return typeof source === "string" ? { file: from, source, imported: "*" } : undefined;
  };
  const isRequire = (file, expression, seen = new Set()) => {
    const node = unwrapExpression(expression);
    if (!node || seen.has(node)) return false;
    load(file);
    const next = new Set([...seen, node]);
    if (node.type === "SequenceExpression") return isRequire(file, node.expressions.at(-1), next);
    if (node.type === "Identifier") {
      const def = definition(file, node);
      if (node.name === "require" && !def) return true;
      if (def?.type === "Variable" && isRequire(file, variableValue(def, node), next)) return true;
    }
    if (node.type === "MemberExpression" && staticPropertyName(node) === "require") {
      if (mainModule(file, node.object, next)) return true;
      const owner = resolve(file, node.object);
      const object = owner?.node ?? unwrapExpression(node.object);
      if (
        object?.type === "Identifier" &&
        ["module", "globalThis"].includes(object.name) &&
        !definition(owner?.file ?? file, object)
      )
        return true;
    }
    const found = resolve(file, node);
    if (found?.node?.type !== "CallExpression") return false;
    const callee = unwrapExpression(found.node.callee);
    if (
      callee?.type === "MemberExpression" &&
      staticPropertyName(callee) === "bind" &&
      isRequire(found.file, callee.object, next)
    )
      return true;
    const factory = loaderBinding(found.file, callee, next);
    return (
      ["node:module", "module"].includes(factory?.source) && factory.imported === "createRequire"
    );
  };
  return isRequire;
};
