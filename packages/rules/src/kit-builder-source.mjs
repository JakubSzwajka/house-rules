import * as fs from "node:fs";
import path from "node:path";
import { featureOptions } from "./feature-origin.mjs";
import { unwrapExpression } from "./import-bindings.mjs";
import { sourceGlob, sourceJson } from "./source-cache.mjs";

export const kitBuilderOrigin = (found) =>
  /^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(found?.source) &&
  [
    "defineOperation",
    "bindOperation",
    "defineFeature",
    "defineReadModel",
    "defineWay",
    "endpoint",
  ].includes(found?.imported);

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
      ["defineFeature", "defineReadModel", "defineWay", "endpoint"].includes(origin?.imported) &&
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

const children = new WeakMap();
const builderChildren = (node) => {
  if (!children.has(node)) {
    const entries = [];
    for (const [key, value] of Object.entries(node)) {
      if (["parent", "loc", "range", "tokens", "comments", "id", "key", "property"].includes(key))
        continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child === "object" && typeof child.type === "string")
          entries.push([key, child]);
    }
    children.set(node, entries);
  }
  return children.get(node);
};

export const sourceBuilderOrigin = ({ resolve, definition, targetSource, load, named }) => {
  const builderOrigins = new Map();
  const mayBuild = possibleBuilder(load, targetSource);
  return (file, expression, { imported, completed = false } = {}) => {
    const root = resolve(file, expression, new Set(), true);
    const rootNode = root?.node;
    if (rootNode && !mayBuild(root.file, imported)) return undefined;
    const mode = `${imported ?? "*"}:${completed}`;
    if (rootNode && !builderOrigins.has(rootNode)) builderOrigins.set(rootNode, new Map());
    const memo = builderOrigins.get(rootNode);
    if (memo?.has(mode)) return memo.get(mode);
    const pending = [{ found: root, withinFunction: false }];
    const seen = new Set();
    while (pending.length) {
      const { found, withinFunction } = pending.pop();
      if (!found) continue;
      if (kitBuilderOrigin(found)) {
        if (
          (imported && found.imported !== imported) ||
          (withinFunction && found.imported === "bindOperation")
        )
          continue;
        memo?.set(mode, found);
        return found;
      }
      const node = found.node;
      if (
        !node ||
        seen.has(node) ||
        (node.type === "CallExpression" &&
          !completed &&
          !withinFunction &&
          !(
            node.callee.type === "MemberExpression" &&
            !node.callee.computed &&
            node.callee.property.name === "bind"
          ))
      )
        continue;
      seen.add(node);
      const exports = builderExportSources(found.file, node, targetSource, load, named);
      if (exports) {
        for (const source of exports) pending.push({ found: source, withinFunction });
        continue;
      }
      const nested =
        withinFunction ||
        ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(
          node.type,
        );
      const callee = node.type === "CallExpression" && unwrapExpression(node.callee);
      const binding = callee?.type === "Identifier" && definition(found.file, callee);
      const completedWay =
        withinFunction &&
        binding?.node?.type === "ImportSpecifier" &&
        (binding.node.imported.name ?? binding.node.imported.value) === "defineWay" &&
        binding.parent.source.value === "@house-rules/application" &&
        featureOptions(
          { resolve },
          found.file.slice(0, found.file.lastIndexOf(`${path.sep}src${path.sep}`) + 5),
          found.file,
          node.arguments[0],
          true,
          true,
        ).length === 0;
      for (const [key, child] of builderChildren(node)) {
        // A completed way is a value; keep scanning its arguments for escaped builders.
        if (completedWay && key === "callee") continue;
        pending.push({
          found: resolve(found.file, child, new Set(), true),
          withinFunction:
            nested &&
            (!["Identifier", "MemberExpression"].includes(child.type) ||
              kitBuilderOrigin(resolve(found.file, child))),
        });
      }
    }
    memo?.set(mode, undefined);
    return undefined;
  };
};

const possibleBuilder = (load, targetSource) => {
  const absent = new Map();
  const present = new Map();
  return (file, imported) => {
    const mode = imported ?? "*";
    let positive = present.get(mode);
    if (!positive) present.set(mode, (positive = new Set()));
    if (positive.has(file)) return true;
    let negative = absent.get(mode);
    if (!negative) absent.set(mode, (negative = new Set()));
    const pending = [file];
    const seen = new Set();
    while (pending.length) {
      const from = pending.pop();
      if (seen.has(from) || negative.has(from)) continue;
      seen.add(from);
      for (const statement of load(from)?.body ?? []) {
        const source =
          statement.type === "TSImportEqualsDeclaration"
            ? statement.moduleReference.expression?.value
            : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(
                  statement.type,
                )
              ? statement.source?.value
              : undefined;
        if (typeof source !== "string") continue;
        if (/^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(source)) {
          const specs = statement.specifiers;
          if (
            !specs ||
            specs.some((spec) =>
              spec.type !== "ImportSpecifier" && spec.type !== "ExportSpecifier"
                ? true
                : kitBuilderOrigin({
                    source,
                    imported:
                      spec.imported?.name ??
                      spec.imported?.value ??
                      spec.local.name ??
                      spec.local.value,
                  }) &&
                  (imported === undefined ||
                    (spec.imported?.name ??
                      spec.imported?.value ??
                      spec.local.name ??
                      spec.local.value) === imported),
            )
          ) {
            positive.add(file);
            return true;
          }
        } else {
          const target = targetSource(from, source);
          if (target) pending.push(target);
        }
      }
    }
    // No reachable import names this builder. Every visited file shares that negative proof.
    for (const from of seen) negative.add(from);
    return false;
  };
};

export const kitImplementation = (filename, cwd, roots) => {
  for (const manifest of sourceGlob(
    cwd,
    roots.map((root) => `${root}/{domain,application}/package.json`),
  )) {
    try {
      const file = path.resolve(cwd, manifest);
      const root = fs.realpathSync(path.dirname(file));
      const kit = path.basename(root);
      if (
        ["domain", "application"].includes(kit) &&
        sourceJson(file).name === `@house-rules/${kit}` &&
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
