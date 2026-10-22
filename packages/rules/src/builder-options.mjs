import { unwrapExpression } from "./import-bindings.mjs";

export function builderOptions(expression, hasFeatures) {
  const options = unwrapExpression(expression);
  if (options?.type !== "ObjectExpression") return undefined;
  const properties = options.properties;
  if (
    properties.some(
      (property) =>
        property.type !== "Property" ||
        property.computed ||
        property.kind !== "init" ||
        property.method,
    )
  )
    return undefined;
  const features = properties.filter(
    (property) => (property.key.name ?? property.key.value) === "features",
  );
  if (hasFeatures && features.length !== 1) return undefined;
  const publicFeatures = properties.filter(
    (property) => (property.key.name ?? property.key.value) === "public",
  );
  if (publicFeatures.length > 1) return undefined;
  return { features: features[0]?.value, public: publicFeatures[0]?.value };
}
