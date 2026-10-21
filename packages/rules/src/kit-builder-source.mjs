import * as fs from "node:fs";
import path from "node:path";

export const kitBuilderOrigin = (found) =>
  /^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(found?.source) &&
  ["defineOperation", "bindOperation", "defineFeature", "defineWay", "endpoint"].includes(
    found?.imported,
  );

export const builderFromExport = (found, origin) =>
  found?.node ? origin(found.file, found.node) : kitBuilderOrigin(found) ? found : undefined;

export const kitBuilderExports = (node) => {
  if (!/^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(node.source?.value)) return [];
  return node.type === "ExportAllDeclaration"
    ? [node.source.value.startsWith("@house-rules/domain") ? "defineOperation" : "defineFeature"]
    : node.specifiers.map((spec) => spec.local.name ?? spec.local.value);
};

export const builderExportSources = (file, node, targetSource, load, named) => {
  if (node.type === "Program")
    return node.body
      .filter((statement) => statement.type.startsWith("Export") && statement.exportKind !== "type")
      .map((statement) => ({ file, node: statement }));
  if (!["ExportAllDeclaration", "ExportNamedDeclaration"].includes(node.type) || !node.source)
    return undefined;
  if (node.exportKind === "type") return [];
  const target = targetSource(file, node.source.value);
  const found = !target
    ? []
    : node.type === "ExportAllDeclaration"
      ? [{ file: target, node: load(target) }]
      : node.specifiers
          .filter((spec) => spec.exportKind !== "type")
          .map((spec) => named(target, spec.local.name ?? spec.local.value, true));
  return [
    ...found,
    ...kitBuilderExports(node).map((imported) => ({ source: node.source.value, imported })),
  ];
};

export const forbiddenBuilderImports = (context, graph, filename, node, report) => {
  if (node.importKind === "type") return;
  for (const spec of node.specifiers) {
    if (spec.type !== "ImportSpecifier" || spec.importKind === "type") continue;
    const used = context.sourceCode.scopeManager.scopes.some((scope) =>
      scope.references.some(
        (ref) =>
          ref.isValueReference &&
          !["TSTypeQuery", "TSQualifiedName"].includes(ref.identifier.parent?.type) &&
          ref.resolved?.defs[0]?.node === spec,
      ),
    );
    if (used) continue;
    const origin = graph.resolve(filename, spec.local);
    if (
      ["defineFeature", "defineWay", "endpoint"].includes(origin?.imported) &&
      /^@house-rules\/application(?:\/contract)?$/u.test(origin.source)
    )
      report(spec, origin.imported);
  }
};

export const importedOrigin = (resolve, file, expression, matches, seen = new Set()) => {
  const found = resolve(file, expression, new Set(), true);
  if (!found) return undefined;
  if (found.imported) return matches(found.source) ? found : undefined;
  const node = found.annotation ?? found.node;
  if (!node || seen.has(node)) return undefined;
  const next = new Set([...seen, node]);
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments", "id", "key", "property"].includes(key))
      continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (!child || typeof child !== "object" || typeof child.type !== "string") continue;
      const origin = importedOrigin(resolve, found.file, child, matches, next);
      if (origin) return origin;
    }
  }
  return undefined;
};

export const kitImplementation = (filename, cwd, roots) => {
  for (const manifest of fs.globSync(
    roots.map((root) => `${root}/{domain,application}/package.json`),
    { cwd },
  )) {
    try {
      const file = path.resolve(cwd, manifest);
      const root = fs.realpathSync(path.dirname(file));
      const kit = path.basename(root);
      if (
        ["domain", "application"].includes(kit) &&
        JSON.parse(fs.readFileSync(file, "utf8")).name === `@house-rules/${kit}` &&
        (fs.existsSync(filename) ? fs.realpathSync(filename) : filename).startsWith(
          `${root}${path.sep}src${path.sep}`,
        )
      )
        return true;
    } catch {
      /* an unreadable or mismatched kit root grants no exemption */
    }
  }
  return false;
};
