import * as fs from "node:fs";
import path from "node:path";
import { sourcePackages } from "./source-packages.mjs";
import { cachedFile } from "./source-cache.mjs";
import { objectProperty } from "./object-property.mjs";
import { parseForESLint } from "@typescript-eslint/parser";
import { unwrapExpression } from "./import-bindings.mjs";
import { sourceDefinitions, variableValue, requireIdentity } from "./source-bindings.mjs";
import { builderFromExport, importedOrigin, sourceBuilderOrigin } from "./kit-builder-source.mjs";
import { relativeSource, installedContractSource } from "./relative-source.mjs";
export { relativeSource } from "./relative-source.mjs";

const parseSource = (file) =>
  parseForESLint(fs.readFileSync(file, "utf8"), {
    sourceType: "module",
    range: true,
    loc: true,
  });

export const sourceGraph = (
  filename,
  program,
  scopeManager,
  { cwd = process.cwd(), packagesDir = [], workspaces = [] } = {},
) => {
  let packages;
  const targets = new Map();
  const targetSource = (file, source) => {
    const key = JSON.stringify([file, source]);
    if (!targets.has(key))
      targets.set(
        key,
        relativeSource(file, source) ??
          (packages ??= sourcePackages(cwd, packagesDir, workspaces)).get(source) ??
          installedContractSource(file, source),
      );
    return targets.get(key);
  };
  const cache = new Map([[path.resolve(filename), program]]);
  const scopes = new Map([[path.resolve(filename), scopeManager]]);
  const load = (file) => {
    if (!cache.has(file)) {
      try {
        const parsed = cachedFile(file, parseSource);
        cache.set(file, parsed.ast);
        scopes.set(file, parsed.scopeManager);
      } catch {
        cache.set(file, undefined);
      }
    }
    return cache.get(file);
  };
  const names = new Map();
  const named = (file, name, exported = false, seen = new Set()) => {
    // Recursive cycle cuts depend on the caller's path. Only memoize fresh walks.
    if (seen.size) return findNamed(file, name, exported, seen);
    const key = JSON.stringify([file, name, exported]);
    if (!names.has(key)) names.set(key, findNamed(file, name, exported, seen));
    return names.get(key);
  };
  const findNamed = (file, name, exported, seen) => {
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
  const definition = sourceDefinitions(scopes);
  const resolutions = new Map();
  const resolve = (file, expression, seen = new Set(), allowMutable = false) => {
    if (seen.size) return resolveExpression(file, expression, seen, allowMutable);
    let memo = resolutions.get(file);
    if (!memo) resolutions.set(file, (memo = [new Map(), new Map()]));
    const cache = memo[Number(allowMutable)];
    if (!cache.has(expression))
      cache.set(expression, resolveExpression(file, expression, seen, allowMutable));
    return cache.get(expression);
  };
  const resolveExpression = (file, expression, seen, allowMutable) => {
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
          return (
            objectProperty(
              (from, value) => resolve(from, value, seen, allowMutable),
              object.file,
              object.node,
              name,
            ) || undefined
          );
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
    const found =
      def?.type === "Variable" ? { file, node: variableValue(def, node) } : named(file, node.name);
    if (found?.unstable && !allowMutable) return undefined;
    if (!found?.node) return found;
    const resolved = resolve(found.file, found.node, new Set([...seen, key]), allowMutable);
    return found.annotation
      ? { ...resolved, file: found.file, annotation: found.annotation }
      : resolved;
  };
  const builderOrigin = sourceBuilderOrigin({ resolve, definition, targetSource, load, named });
  const importOrigin = (file, expression, matches) =>
    importedOrigin(resolve, file, expression, matches);
  const isRequire = requireIdentity(resolve, definition, load);
  const packageBuilder = (from, source, imported, options) => {
    const file = targetSource(from, source);
    if (!file) return undefined;
    if (imported === undefined) return builderOrigin(file, load(file), options);
    return builderFromExport(named(file, imported, true), (from, node) =>
      builderOrigin(from, node, options),
    );
  };
  return { resolve, builderOrigin, importOrigin, isRequire, packageBuilder };
};
