import { builderOptions } from "./builder-options.mjs";
import { unwrapExpression } from "./import-bindings.mjs";

// Prove descriptor origins, not handler purity. Runtime repeats graph validation on actual values.
export const readEntryEdges = (graph, file, expression, seen = new Set()) => {
  const options = builderOptions(expression, false);
  if (!options) return false;
  const flags = options.flags === undefined ? {} : builderOptions(options.flags, false);
  if (!flags) return false;
  for (const [name, expected] of [
    ["readOnly", true],
    ["destructive", false],
  ]) {
    if (flags[name] !== undefined && unwrapExpression(flags[name])?.value !== expected)
      return false;
  }
  if (options.edges === undefined) return true;
  const edges = unwrapExpression(options.edges);
  if (edges?.type !== "ArrayExpression") return false;
  return edges.elements.every((edge) => {
    if (!edge) return false;
    let found = graph.resolve(file, edge);
    if (found?.node?.type !== "CallExpression") return false;
    let builder = graph.resolve(found.file, found.node.callee);
    if (builder?.source === "@house-rules/domain/contract" && builder.imported === "asSystem") {
      found = graph.resolve(found.file, found.node.arguments[0]);
      if (found?.node?.type !== "CallExpression") return false;
      builder = graph.resolve(found.file, found.node.callee);
    }
    if (
      builder?.source !== "@house-rules/domain/contract" ||
      builder.imported !== "defineOperation"
    )
      return false;
    if (seen.has(found.node)) return false;
    const target = builderOptions(found.node.arguments[1], false);
    const ownFlags = target?.flags === undefined ? {} : builderOptions(target.flags, false);
    const readOnly = target?.readOnly ?? ownFlags?.readOnly;
    if (unwrapExpression(readOnly)?.value !== true) return false;
    return readEntryEdges(
      graph,
      found.file,
      found.node.arguments[1],
      new Set([...seen, found.node]),
    );
  });
};
