import path from "node:path";
import { unwrapExpression } from "./import-bindings.mjs";

export const featureOrigin = (graph, app, file, expression, list = false, seen = new Set()) => {
  const found = graph.resolve(file, expression);
  if (!found?.node || seen.has(found.node)) return false;
  const next = new Set([...seen, found.node]);
  const node = unwrapExpression(found.node);
  if (list && node.type === "ArrayExpression")
    return node.elements.every(
      (item) => item && featureOrigin(graph, app, found.file, item, false, next),
    );
  if (list || node.type !== "CallExpression") return false;
  const builder = graph.resolve(found.file, node.callee);
  const location = path.relative(app, found.file).split(path.sep).join("/");
  return (
    builder?.source === "@house-rules/application/contract" &&
    builder.imported === "defineFeature" &&
    /^features\/[^/]+\/index\.ts$/u.test(location)
  );
};
