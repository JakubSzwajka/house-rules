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
