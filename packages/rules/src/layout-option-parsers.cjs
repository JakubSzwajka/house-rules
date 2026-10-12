"use strict";

// Option parsers for layout(). Each one validates a value and returns the Dependency Cruiser pattern for it.
const DEFAULT_LAYERS = {
  delivery: "delivery",
  server: "server",
  useCases: "use-cases",
  composition: "composition",
};

// Dots become `[.]` so the default patterns stay byte-equal to drunk-cat-stack's hand-written ones.
function escape(value) {
  return value.replace(/[\\^$*+?()[\]{}|]/g, "\\$&").replace(/[.]/g, "[.]");
}

function pathOption(value, label) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.endsWith("/")) {
    throw new TypeError(
      `layout(): ${label} must be a non-empty relative path without a leading or trailing "/".`,
    );
  }
  return escape(value);
}

function scopeName(scope) {
  if (typeof scope !== "string" || !scope || scope === "/") {
    throw new TypeError('layout(): scope is required, for example "@acme/".');
  }
  return scope.endsWith("/") ? scope : `${scope}/`;
}

function nameListOption(names, label, { allowEmpty }, toPattern = escape) {
  const valid =
    Array.isArray(names) &&
    (allowEmpty || names.length > 0) &&
    names.every((name) => typeof name === "string" && name && !name.includes("/"));
  if (!valid) {
    const size = allowEmpty ? "an array" : "a non-empty array";
    throw new TypeError(`layout(): ${label} must be ${size} of names without "/".`);
  }
  return names.map(toPattern);
}

// Each entry is a relative path such as "runtime.ts" or "runtime/index.ts". Returns one alternation, or
// null for an empty list, so the rule keeps its 0.11.0 shape.
function pathListOption(paths, label, isAllowed = () => true, hint = "") {
  const valid =
    Array.isArray(paths) &&
    paths.every(
      (entry) =>
        typeof entry === "string" &&
        entry &&
        !entry.startsWith("/") &&
        !entry.endsWith("/") &&
        !entry.split("/").includes("..") &&
        isAllowed(entry),
    );
  if (!valid) {
    throw new TypeError(
      `layout(): ${label} must be an array of relative paths without a leading or trailing "/" or ".."${hint}.`,
    );
  }
  return paths.length ? `(?:${paths.map(escape).join("|")})` : null;
}

// A mechanism name matches in any letter case, so `Types.ts` and `Errors/` fail like `types.ts`.
// Dependency Cruiser patterns carry no flags, so each letter becomes a class such as `[tT]`.
function caseless(name) {
  return [...name]
    .map((char) =>
      char.toLowerCase() === char.toUpperCase()
        ? escape(char)
        : `[${char.toLowerCase()}${char.toUpperCase()}]`,
    )
    .join("");
}

const glob = (value) => value.split("*").map(escape).join("[^/]*");

// A bare specifier becomes a pattern over the resolved path under node_modules. The subpath may sit
// one folder down, such as effect's `dist/`, as package `exports` maps usually put it. A specifier in
// the layout's scope also matches the workspace folder under packagesDir named after it, where
// a workspace link resolves to: `@acme/db` matches `packages/db/`. Returns the installed patterns
// and, per workspace package, its folder pattern and its import pattern.
function adapterImportsOption(specifiers, scope, packages) {
  const valid =
    Array.isArray(specifiers) &&
    specifiers.length > 0 &&
    specifiers.every(
      (specifier) =>
        typeof specifier === "string" &&
        /^(?:@[^/]+\/)?[^@./][^/]*(?:\/[^/]+)*$/u.test(specifier) &&
        !specifier.endsWith("/"),
    );
  if (!valid) {
    throw new TypeError(
      'layout(): adapterImports must be a non-empty array of bare import specifiers, such as "effect/unstable/sql" or "@effect/sql-*".',
    );
  }
  const installed = [];
  const workspace = [];
  for (const specifier of specifiers) {
    const parts = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const name = parts.slice(0, nameLength).map(glob).join("/");
    const subpath = parts.slice(nameLength).map(glob).join("/");
    const rest = subpath ? `(?:[^/]+/|)${subpath}(?:[/.]|$)` : "";
    installed.push(`(?:^|/)node_modules/${name}/${rest}`);
    if (specifier.startsWith(scope) && nameLength === 2) {
      workspace.push({
        folder: `^${packages}/${glob(parts[1])}/`,
        path: `^${packages}/${glob(parts[1])}/${rest}`,
      });
    }
  }
  return { installed, workspace };
}

// `hostLayers` are a host preset's defaults, such as Next's `app` folder; the app's own layers win.
function layerOptions(layers, hostLayers = {}) {
  if (layers === null || typeof layers !== "object" || Array.isArray(layers)) {
    throw new TypeError("layout(): layers must be an object.");
  }
  for (const name of Object.keys(layers)) {
    if (!(name in DEFAULT_LAYERS)) {
      throw new TypeError(
        `layout(): unknown layer "${name}". Known layers: ${Object.keys(DEFAULT_LAYERS).join(", ")}.`,
      );
    }
  }
  const merged = { ...DEFAULT_LAYERS, ...hostLayers, ...layers };
  return Object.fromEntries(
    Object.entries(merged).map(([name, value]) => [name, pathOption(value, `layers.${name}`)]),
  );
}

module.exports = {
  adapterImportsOption,
  caseless,
  escape,
  layerOptions,
  nameListOption,
  pathListOption,
  pathOption,
  scopeName,
};
