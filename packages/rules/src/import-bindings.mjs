export function staticPropertyName(member) {
  if (member.type !== "MemberExpression") return undefined;
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal") {
    return typeof member.property.value === "string" ? member.property.value : undefined;
  }
  return undefined;
}

export function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSInstantiationExpression" ||
      current.type === "ChainExpression")
  ) {
    current = current.expression;
  }
  return current;
}

function importedName(specifier) {
  if (specifier.type === "ImportNamespaceSpecifier") return "*";
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  return specifier.imported.name ?? specifier.imported.value;
}

// Resolves through scopes, so a local binding that shadows an import is not mistaken for it.
export function importOf(identifier, sourceCode) {
  if (identifier?.type !== "Identifier") return null;
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      const definition = variable.defs[0];
      if (definition?.type !== "ImportBinding") return null;
      const declaration = definition.parent;
      if (declaration.importKind === "type" || definition.node.importKind === "type") return null;
      return { source: declaration.source.value, imported: importedName(definition.node) };
    }
    scope = scope.upper;
  }
  return null;
}
