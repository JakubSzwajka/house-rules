import path from "node:path";
import { unwrapExpression } from "./import-bindings.mjs";
import { builderOptions } from "./builder-options.mjs";

export const featureOptions = (graph, app, file, expression, hasFeatures, hasPublic) => {
  const options = builderOptions(expression, false);
  if (!options) return ["options"];
  const resolvedProtocol = graph.resolve(file, options.protocol);
  const protocolValue = resolvedProtocol?.node && unwrapExpression(resolvedProtocol.node);
  if (hasPublic && protocolValue?.type === "Literal" && protocolValue.value === "event") {
    if (
      options.features !== undefined ||
      options.feature === undefined ||
      options.mean === undefined
    )
      return ["options"];
    const messages = [];
    if (!featureOrigin(graph, app, file, options.feature)) messages.push("exposure");
    if (!featureOrigin(graph, app, file, options.feature, false, new Set(), true))
      messages.push("system");
    return messages;
  }
  if (hasFeatures && options.features === undefined) return ["options"];
  const messages = [];
  if (hasFeatures && !featureOrigin(graph, app, file, options.features, true))
    messages.push("exposure");
  if (
    hasPublic &&
    options.public !== undefined &&
    !featureOrigin(graph, app, file, options.public, true)
  )
    messages.push("exposure");
  if (hasPublic && options.protocol !== undefined) {
    const resolved = graph.resolve(file, options.protocol);
    const protocol = resolved?.node && unwrapExpression(resolved.node);
    if (
      protocol?.type !== "Literal" ||
      !["http", "mcp", "hook", "schedule", "event"].includes(protocol.value)
    )
      messages.push("options");
    else if (
      ["hook", "schedule"].includes(protocol.value) &&
      !featureOrigin(graph, app, file, options.features, true, new Set(), true)
    )
      messages.push("system");
  }
  return messages;
};

export const featureOrigin = (
  graph,
  app,
  file,
  expression,
  list = false,
  seen = new Set(),
  system = false,
) => {
  const found = graph.resolve(file, expression);
  if (!found?.node || seen.has(found.node)) return false;
  const next = new Set([...seen, found.node]);
  const node = unwrapExpression(found.node);
  if (list && node.type === "ArrayExpression")
    return node.elements.every(
      (item) => item && featureOrigin(graph, app, found.file, item, false, next, system),
    );
  if (list || node.type !== "CallExpression") return false;
  const builder = graph.resolve(found.file, node.callee);
  const location = path.relative(app, found.file).split(path.sep).join("/");
  const origin =
    builder?.source === "@house-rules/application/contract" &&
    builder.imported === "defineFeature" &&
    /^features\/[^/]+\/index\.ts$/u.test(location);
  if (!origin || !system) return origin;
  const options = builderOptions(node.arguments[1], false);
  const start = graph.resolve(found.file, options?.start);
  if (!start?.node) return false;
  const value = unwrapExpression(start.node);
  if (value.type === "CallExpression") {
    const owner = graph.resolve(start.file, value.callee);
    return (
      owner?.source === "@house-rules/application/contract" && owner.imported === "systemStart"
    );
  }
  const fields = builderOptions(value, false);
  return fields?.kind?.type === "Literal" && fields.kind.value === "system";
};
