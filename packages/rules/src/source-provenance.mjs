import * as fs from "node:fs";
import path from "node:path";
import { parseForESLint } from "@typescript-eslint/parser";
import { unwrapExpression } from "./import-bindings.mjs";
import { featureOptions } from "./feature-origin.mjs";
import {
  builderFromExport,
  importedOrigin,
  builderExportSources,
  kitBuilderOrigin,
} from "./kit-builder-source.mjs";
import { relativeSource } from "./relative-source.mjs";
export { relativeSource } from "./relative-source.mjs";

export const sourceGraph = (
  filename,
  program,
  scopeManager,
  { cwd = process.cwd(), packagesDir = [], workspaces = [] } = {},
) => {
  const packages = new Map();
  for (const manifest of [
    ...fs.globSync(
      packagesDir.map((root) => `${root}/*/package.json`),
      { cwd },
    ),
    ...workspaces.map((workspace) => path.join(workspace, "package.json")),
  ]) {
    try {
      const file = path.resolve(cwd, manifest);
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (["@house-rules/domain", "@house-rules/application"].includes(json.name)) continue;
      for (const [key, entry] of Object.entries(json.exports ?? { ".": "./src/index.ts" })) {
        const target = typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
        if ([".", "./contract"].includes(key) && typeof target === "string")
          packages.set(
            json.name + (key === "." ? "" : "/contract"),
            path.resolve(path.dirname(file), target),
          );
      }
    } catch {
      /* unresolved package source fails at its use */
    }
  }
  const targetSource = (file, source) => relativeSource(file, source) ?? packages.get(source);
  const cache = new Map([[path.resolve(filename), program]]);
  const scopes = new Map([[path.resolve(filename), scopeManager]]);
  const load = (file) => {
    if (!cache.has(file)) {
      try {
        const parsed = parseForESLint(fs.readFileSync(file, "utf8"), {
          sourceType: "module",
          range: true,
          loc: true,
        });
        cache.set(file, parsed.ast);
        scopes.set(file, parsed.scopeManager);
      } catch {
        cache.set(file, undefined);
      }
    }
    return cache.get(file);
  };
  const named = (file, name, exported = false, seen = new Set()) => {
    const key = `${file}:${name}:${exported}`;
    if (seen.has(key)) return undefined;
    const next = new Set([...seen, key]);
    const ast = load(file);
    if (!ast) return undefined;
    if (exported && name === "*") return { file, node: ast };
    const statements = exported
      ? [...ast.body].sort(
          (a, b) =>
            Number(a.type === "ExportAllDeclaration") - Number(b.type === "ExportAllDeclaration"),
        )
      : ast.body;
    for (const statement of statements) {
      if (
        !exported &&
        statement.type === "TSImportEqualsDeclaration" &&
        statement.id.name === name &&
        statement.moduleReference.type === "TSExternalModuleReference"
      ) {
        const source = statement.moduleReference.expression.value;
        const target = targetSource(file, source);
        return target ? named(target, "*", true, next) : { file, source, imported: "*" };
      }
      if (!exported && statement.type === "ImportDeclaration") {
        const spec = statement.specifiers.find((item) => item.local.name === name);
        if (spec) {
          const imported =
            spec.type === "ImportSpecifier"
              ? (spec.imported.name ?? spec.imported.value)
              : spec.type === "ImportNamespaceSpecifier"
                ? "*"
                : "default";
          const source = statement.source.value;
          const target = targetSource(file, source);
          return target
            ? (named(target, imported, true, next) ??
                (imported === "default" ? named(target, "*", true, next) : undefined))
            : { file, source, imported };
        }
      }
      if (exported && name === "default" && statement.type === "ExportDefaultDeclaration")
        return { file, node: statement.declaration };
      if (statement.type === "ExportNamedDeclaration" || !exported) {
        const declaration =
          statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
        if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === name)
          return { file, node: declaration };
        if (declaration?.type === "VariableDeclaration") {
          const item = declaration.declarations.find(
            (item) => item.id.type === "Identifier" && item.id.name === name,
          );
          if (item)
            return {
              file,
              node: item.init,
              annotation: item.id.typeAnnotation?.typeAnnotation,
              unstable: declaration.kind !== "const",
            };
        }
      }
      if (statement.type === "ExportNamedDeclaration" && exported && !statement.declaration) {
        const spec = statement.specifiers.find(
          (item) => (item.exported.name ?? item.exported.value) === name,
        );
        if (spec) {
          const target = statement.source && targetSource(file, statement.source.value);
          return statement.source
            ? target
              ? named(target, spec.local.name ?? spec.local.value, true, next)
              : {
                  file,
                  source: statement.source.value,
                  imported: spec.local.name ?? spec.local.value,
                }
            : named(file, spec.local.name ?? spec.local.value, false, next);
        }
      }
      if (
        statement.type === "ExportAllDeclaration" &&
        statement.exportKind !== "type" &&
        exported
      ) {
        const target = targetSource(file, statement.source.value);
        if (statement.exported) {
          if ((statement.exported.name ?? statement.exported.value) !== name) continue;
          return target
            ? named(target, "*", true, next)
            : { file, source: statement.source.value, imported: "*" };
        }
        const found = target
          ? named(target, name, true, next)
          : { file, source: statement.source.value, imported: name };
        if (found) return found;
      }
    }
    return undefined;
  };
  const definition = (file, node) =>
    scopes
      .get(file)
      ?.scopes.flatMap((scope) => scope.references)
      .find((reference) => reference.identifier === node)?.resolved?.defs[0];
  const resolve = (file, expression, seen = new Set(), allowMutable = false) => {
    const node = unwrapExpression(expression);
    if (node?.type === "MemberExpression") {
      const object = resolve(file, node.object, seen, allowMutable);
      const name = node.computed ? node.property.value : node.property.name;
      if (typeof name === "string") {
        if (
          object?.imported === "*" ||
          (object?.imported === "default" && ["node:module", "module"].includes(object.source))
        )
          return { ...object, imported: name };
        if (object?.node?.type === "ObjectExpression") {
          const property = object.node.properties.find(
            (item) => item.type === "Property" && (item.key.name ?? item.key.value) === name,
          );
          if (property) return resolve(object.file, property.value, seen, allowMutable);
        }
        if (object?.node?.type === "Program") {
          const found = named(object.file, name, true);
          if (found?.unstable && !allowMutable) return undefined;
          return found?.node ? resolve(found.file, found.node, seen, allowMutable) : found;
        }
      }
    }
    if (node?.type !== "Identifier") return { file, node };
    const key = `${file}:${node.name}`;
    if (seen.has(key)) return undefined;
    load(file);
    const def = definition(file, node);
    if (def && !["ImportBinding", "Variable"].includes(def.type)) return undefined;
    if (def?.type === "Variable" && def.parent.kind !== "const" && !allowMutable) return undefined;
    const found = def?.type === "Variable" ? { file, node: def.node.init } : named(file, node.name);
    if (found?.unstable && !allowMutable) return undefined;
    if (!found?.node) return found;
    const resolved = resolve(found.file, found.node, new Set([...seen, key]), allowMutable);
    return found.annotation
      ? { ...resolved, file: found.file, annotation: found.annotation }
      : resolved;
  };
  const builderOrigins = new Map();
  const builderOrigin = (file, expression) => {
    const root = resolve(file, expression, new Set(), true);
    const rootNode = root?.node;
    if (rootNode && builderOrigins.has(rootNode)) return builderOrigins.get(rootNode);
    const pending = [{ found: root, withinFunction: false }];
    const seen = new Set();
    while (pending.length) {
      const { found, withinFunction } = pending.pop();
      if (!found) continue;
      if (kitBuilderOrigin(found)) {
        if (withinFunction && found.imported === "bindOperation") continue;
        if (rootNode) builderOrigins.set(rootNode, found);
        return found;
      }
      const node = found.node;
      if (
        !node ||
        seen.has(node) ||
        (node.type === "CallExpression" &&
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
      for (const [key, value] of Object.entries(node)) {
        if (["parent", "loc", "range", "tokens", "comments", "id", "key", "property"].includes(key))
          continue;
        // A completed way is a value; keep scanning its arguments for escaped builders.
        if (completedWay && key === "callee") continue;
        for (const child of Array.isArray(value) ? value : [value]) {
          if (!child || typeof child !== "object" || typeof child.type !== "string") continue;
          pending.push({
            found: resolve(found.file, child, new Set(), true),
            withinFunction:
              nested &&
              (!["Identifier", "MemberExpression"].includes(child.type) ||
                kitBuilderOrigin(resolve(found.file, child))),
          });
        }
      }
    }
    if (rootNode) builderOrigins.set(rootNode, undefined);
    return undefined;
  };
  const importOrigin = (file, expression, matches) =>
    importedOrigin(resolve, file, expression, matches);
  const isRequire = (file, expression) => {
    const node = unwrapExpression(expression);
    if (node?.type === "Identifier" && node.name === "require" && !definition(file, node))
      return true;
    const found = resolve(file, node);
    if (found?.node?.type !== "CallExpression") return false;
    const factory = resolve(found.file, found.node.callee);
    return (
      ["node:module", "module"].includes(factory?.source) && factory.imported === "createRequire"
    );
  };
  const packageBuilder = (from, source, imported) => {
    const file = targetSource(from, source);
    if (!file) return undefined;
    if (imported === undefined) return builderOrigin(file, load(file));
    return builderFromExport(named(file, imported, true), builderOrigin);
  };
  return { resolve, builderOrigin, importOrigin, isRequire, packageBuilder };
};
