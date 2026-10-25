import { readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseForESLint } from "@typescript-eslint/parser";

const kitPackages = new Set([
  "@house-rules/rules",
  "@house-rules/domain",
  "@house-rules/application",
]);
const parse = async (path) =>
  parseForESLint(await readFile(path, "utf8"), { filePath: path, sourceType: "module" }).ast;
const literal = (node) => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  throw new Error("App map requires a literal source fact");
};
const unique = (values, label) => {
  if (values.length !== 1)
    throw new Error(`App map requires exactly one source for ${label}, found ${values.length}`);
  return values[0];
};
const entries = async (directory, optional = false) => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    throw error;
  }
};
const files = async (directory, optional = false) => {
  const result = [];
  for (const entry of (await entries(directory, optional)).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (["tests", "adapters", "node_modules", "dist"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("App map source directories must not be symlinks");
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.name.endsWith(".ts")) result.push(path);
  }
  return result;
};
const calls = (source, builder) => {
  const names = source.body
    .filter(
      (node) =>
        node.type === "ImportDeclaration" &&
        [
          "@house-rules/domain",
          "@house-rules/domain/contract",
          "@house-rules/application",
          "@house-rules/application/contract",
        ].includes(node.source.value),
    )
    .flatMap((node) =>
      node.specifiers
        .filter(
          (specifier) =>
            specifier.type === "ImportSpecifier" && specifier.imported.name === builder,
        )
        .map((specifier) => specifier.local.name),
    );
  const result = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      names.includes(node.callee.name)
    )
      result.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (["parent", "tokens", "comments", "loc", "range"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(source);
  return result;
};
const installedPackage = async (packageName, appDirectory, rootDirectory, packageRoots) => {
  if (typeof packageName !== "string" || !packageName.startsWith("@house-rules/")) return undefined;
  let current = resolve(appDirectory);
  const root = resolve(rootDirectory);
  while (current === root || current.startsWith(`${root}/`)) {
    const directory = resolve(current, "node_modules", ...packageName.split("/"));
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      if (manifest.name === packageName) {
        const realDirectory = await realpath(directory);
        if (
          packageRoots.some(
            (base) => realDirectory === base || realDirectory.startsWith(`${base}/`),
          )
        )
          return undefined;
        return { manifest, path: relative(rootDirectory, directory) };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === root) break;
    const parent = resolve(current, "..");
    if (parent === current || !(parent === root || parent.startsWith(`${root}/`))) break;
    current = parent;
  }
  return undefined;
};
const operationNames = async (directory) => {
  const names = [];
  for (const path of await files(directory))
    for (const call of calls(await parse(path), "defineOperation"))
      names.push(literal(call.arguments[0]));
  if (new Set(names).size !== names.length) throw new Error("Ambiguous operation declarations");
  return names;
};

/** Read only literal source facts. Missing and conflicting ownership is an error. */
export const appMapSources = async (snapshot, { appDirectory, rootDirectory, packageRoots }) => {
  const packageDirectories = [];
  const realPackageRoots = [];
  for (const base of packageRoots) {
    realPackageRoots.push(await realpath(resolve(rootDirectory, base)));
    for (const entry of await readdir(resolve(rootDirectory, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(rootDirectory, base, entry.name);
      const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      // Kits build descriptors from data (plans, tests) and never own mounted operations.
      if (kitPackages.has(manifest.name)) continue;
      packageDirectories.push({ directory, path: relative(rootDirectory, directory) });
    }
  }
  const registry = await parse(resolve(appDirectory, "src/features/index.ts"));
  const featurePaths = new Map();
  for (const statement of registry.body.filter((node) => node.type === "ImportDeclaration")) {
    const specifier = literal(statement.source);
    if (!/^\.\/[^/]+\/index\.ts$/.test(specifier))
      throw new Error("App map requires direct feature registry imports");
    const path = resolve(appDirectory, "src/features", specifier);
    const source = await parse(path);
    const call = unique(calls(source, "defineFeature"), specifier);
    const imported = unique(
      statement.specifiers.filter(
        (node) => node.type === "ImportSpecifier" && node.importKind !== "type",
      ),
      specifier,
    );
    const declaration = unique(
      source.body
        .filter(
          (node) =>
            node.type === "ExportNamedDeclaration" &&
            node.declaration?.type === "VariableDeclaration",
        )
        .flatMap((node) => node.declaration.declarations)
        .filter((node) => node.id.name === imported.imported.name),
      specifier,
    );
    if (declaration.init !== call)
      throw new Error("App map requires a direct exported feature declaration");
    const name = literal(call.arguments[0]);
    if (featurePaths.has(name)) throw new Error(`Ambiguous feature ${name}`);
    featurePaths.set(name, relative(appDirectory, path));
  }
  const owners = [];
  for (const { directory, path } of packageDirectories) {
    const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    owners.push({
      name: directory.split("/").at(-1),
      kind: "package",
      package: manifest.name,
      path,
      operations: await operationNames(resolve(directory, "src")),
    });
  }
  const appPackage = JSON.parse(await readFile(resolve(appDirectory, "package.json"), "utf8")).name;
  for (const entry of await entries(resolve(appDirectory, "src/read-models"), true)) {
    if (!entry.isDirectory()) throw new Error("Unexpected read-model entry");
    const directory = resolve(appDirectory, "src/read-models", entry.name);
    owners.push({
      name: entry.name,
      kind: "read-model",
      package: appPackage,
      path: relative(appDirectory, directory),
      operations: await operationNames(directory),
    });
  }
  const wayPaths = new Map();
  for (const path of await files(resolve(appDirectory, "src/ways-in"), true)) {
    for (const call of calls(await parse(path), "defineWay")) {
      const options = call.arguments[0];
      if (
        options?.type !== "ObjectExpression" ||
        options.properties.some((property) => property.type !== "Property" || property.computed)
      )
        throw new Error("App map requires literal way options");
      const property = unique(
        options.properties.filter(
          (property) => property.key.name === "name" || property.key.value === "name",
        ),
        path,
      );
      const name = literal(property.value);
      if (wayPaths.has(name)) throw new Error(`Ambiguous way ${name}`);
      wayPaths.set(name, relative(appDirectory, path));
    }
  }
  return {
    ...snapshot,
    modules: await Promise.all(
      snapshot.modules.map(async (module) => {
        if (module.operations.length === 0)
          throw new Error(`Cannot locate empty mount ${module.service}`);
        const matchingOwners = owners.filter((owner) =>
          module.operations.every((operation) => owner.operations.includes(operation.name)),
        );
        if (matchingOwners.length > 0) {
          const owner = unique(matchingOwners, module.service);
          return {
            ...module,
            name: owner.name,
            kind: owner.kind,
            package: owner.package,
            path: owner.path,
          };
        }
        const installed = await installedPackage(
          module.package,
          appDirectory,
          rootDirectory,
          realPackageRoots,
        );
        if (installed !== undefined) {
          return {
            ...module,
            name: installed.manifest.name.split("/").at(-1),
            kind: "package",
            package: installed.manifest.name,
            version: installed.manifest.version,
            path: installed.path,
          };
        }
        throw new Error(`App map requires exactly one source for ${module.service}, found 0`);
      }),
    ),
    features: snapshot.features.map((feature) => ({
      ...feature,
      path: unique(
        [...featurePaths].filter(([name]) => name === feature.name).map(([, path]) => path),
        feature.name,
      ),
    })),
    ways: snapshot.ways.map((way) => ({
      ...way,
      source: unique(
        [...wayPaths].filter(([name]) => name === way.name).map(([, path]) => path),
        way.name,
      ),
    })),
  };
};
