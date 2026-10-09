"use strict";

// This preset loads no other module, so it carries its own copy of the link. A rule name is its README
// id and already a valid anchor; tests/rule-docs.test.mjs checks each comment against src/rule-docs.mjs.
const seeRuleLine = (name) => `See https://stack.kubaszwajka.com/rules/#${name}`;

const DEFAULTS = {
  appsDir: "apps",
  packagesDir: "packages",
  publicEntry: "src/index.ts",
  internalDir: "src/internal",
  adaptersDir: "src/adapters",
  facadeFile: "src/facade.ts",
  testsDir: "tests",
};
const DEFAULT_LAYERS = { delivery: "delivery", server: "server", useCases: "use-cases" };
const DEFAULT_NAME_LISTS = {
  appEntryFiles: ["main.ts", "index.ts"],
  ownerlessNames: ["utils", "helpers", "misc"],
  mechanismNames: [
    "types",
    "models",
    "schemas",
    "drafts",
    "errors",
    "validate",
    "validation",
    "constants",
    "interfaces",
    "internal",
  ],
  packageRootFiles: ["index.ts", "facade.ts", "storage.ts"],
  adapterPackages: [],
};
const DEFAULT_ADAPTER_IMPORTS = Object.freeze([
  "effect/unstable/sql",
  "@effect/sql-*",
  "@effect/platform-*",
]);
const OPTION_NAMES = new Set([
  "scope",
  "layers",
  "adapterImports",
  ...Object.keys(DEFAULTS),
  ...Object.keys(DEFAULT_NAME_LISTS),
]);
const BUILT_IN_TEST_DIRS = new Set(["test", "tests", "__tests__"]);

// node_modules is not followed, but stays in the graph, so a rule can see which package a file imports.
const EXCLUDED_PATH =
  "^(?!.*node_modules/)(?:|.*/)(?:dist|coverage|generated|[.]turbo|[.]agent_sources)(?:/|$)";

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

function layerOptions(layers) {
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
  const merged = { ...DEFAULT_LAYERS, ...layers };
  return Object.fromEntries(
    Object.entries(merged).map(([name, value]) => [name, pathOption(value, `layers.${name}`)]),
  );
}

function patterns(options) {
  if (Object.hasOwn(options, "adapterImportsSeverity")) {
    throw new TypeError(
      "layout(): adapterImportsSeverity was removed in 0.8.0. adapter-imports-only-in-adapters is always an error: move the import into an adapter, or name the package in adapterPackages.",
    );
  }
  const unknown = Object.keys(options).filter((name) => !OPTION_NAMES.has(name));
  if (unknown.length) {
    throw new TypeError(
      `layout(): unknown option "${unknown[0]}". Known options: ${[...OPTION_NAMES].join(", ")}.`,
    );
  }
  const settings = { ...DEFAULTS, ...options };
  const scope = scopeName(settings.scope);
  const apps = pathOption(settings.appsDir, "appsDir");
  const packages = pathOption(settings.packagesDir, "packagesDir");
  const tests = pathOption(settings.testsDir, "testsDir");
  const layers = layerOptions(settings.layers ?? {});
  const layerRoot = (layer) => `^${apps}/[^/]+/src/${layer}(?:/|$)`;
  const entryFiles = nameListOption(
    settings.appEntryFiles ?? DEFAULT_NAME_LISTS.appEntryFiles,
    "appEntryFiles",
    {
      allowEmpty: true,
    },
  );
  const ownerless = nameListOption(
    settings.ownerlessNames ?? DEFAULT_NAME_LISTS.ownerlessNames,
    "ownerlessNames",
    {
      allowEmpty: false,
    },
  );
  const mechanism = nameListOption(
    settings.mechanismNames ?? DEFAULT_NAME_LISTS.mechanismNames,
    "mechanismNames",
    { allowEmpty: true },
    caseless,
  );
  const rootFiles = nameListOption(
    settings.packageRootFiles ?? DEFAULT_NAME_LISTS.packageRootFiles,
    "packageRootFiles",
    { allowEmpty: false },
  );
  const adapters = pathOption(settings.adaptersDir, "adaptersDir");
  const adapterPackages = nameListOption(
    settings.adapterPackages ?? DEFAULT_NAME_LISTS.adapterPackages,
    "adapterPackages",
    { allowEmpty: true },
  );
  const testDirs = BUILT_IN_TEST_DIRS.has(settings.testsDir)
    ? "tests?|__tests__"
    : `tests?|__tests__|${tests}`;
  const testFile = "[.](?:test|spec)[.][^/]+$";

  return {
    appsRoot: `^${apps}/`,
    packagesRoot: `^${packages}/`,
    workspaceRoot: `^((?:${apps}|${packages})/[^/]+)/`,
    appRoot: `^(${apps}/[^/]+)/`,
    sourceRoot: `^(?:${apps}|${packages})/[^/]+/src(?:/|$)`,
    publicEntry: `${pathOption(settings.publicEntry, "publicEntry")}$`,
    internalRoot: `^${packages}/[^/]+/${pathOption(settings.internalDir, "internalDir")}(?:/|$)`,
    deliveryRoot: layerRoot(layers.delivery),
    serverRoot: layerRoot(layers.server),
    useCasesRoot: layerRoot(layers.useCases),
    appSource: `^${apps}/[^/]+/src/`,
    appLayerOrEntry: [
      `^${apps}/[^/]+/src/(?:${Object.values(layers).join("|")})/`,
      ...(entryFiles.length ? [`^${apps}/[^/]+/src/(?:${entryFiles.join("|")})$`] : []),
    ],
    useCaseEntry: `^(${apps}/[^/]+/src/${layers.useCases}/[^/]+)`,
    useCaseAny: `^${apps}/[^/]+/src/${layers.useCases}/[^/]+`,
    ownerlessPath: [
      `^(?:${apps}|${packages})/(?:.*/)?(?:${ownerless.join("|")})(?:[.][^/]*)?(?:/|$)`,
      ...(mechanism.length
        ? [`^${packages}/[^/]+/(?:.*/)?(?:${mechanism.join("|")})(?:[.][^/]*)?(?:/|$)`]
        : []),
    ],
    packageRootFile: `^${packages}/[^/]+/src/[^/]+$`,
    packageRootFileAllowed: `^${packages}/[^/]+/src/(?:${rootFiles.join("|")})$`,
    // $1 is the package folder. Only the public entry and the facade wire the package's own adapters.
    packageCode: `^(${packages}/[^/]+)/src/`,
    adapterImporters: [
      `^${packages}/[^/]+/${adapters}(?:/|$)`,
      `^${packages}/[^/]+/${pathOption(settings.publicEntry, "publicEntry")}$`,
      `^${packages}/[^/]+/${pathOption(settings.facadeFile, "facadeFile")}$`,
    ],
    ownAdapters: `^$1/${adapters}(?:/|$)`,
    ownAdapterTests: `^$1/${adapters}/tests(?:/|$)`,
    // A file in a subject folder, and the package's own root barrel ($1 is the package folder).
    subjectFile: `^(${packages}/[^/]+)/src/[^/]+/`,
    ownRootBarrel: `^$1/(?:${pathOption(settings.publicEntry, "publicEntry")}|${pathOption(settings.facadeFile, "facadeFile")})$`,
    notSubjectFolder: [
      "^$1/$2(?:/|$)",
      `^${packages}/[^/]+/${adapters}(?:/|$)`,
      `^${packages}/[^/]+/src/(?:${testDirs})(?:/|$)`,
    ],
    testPath: `(?:^|/)(?:${testDirs})(?:/|$)|${testFile}`,
    testFile: `^(?:${apps}|${packages})/[^/]+/.*${testFile}`,
    testFileInTestsDir: `^(?:${apps}|${packages})/[^/]+/src/(?:${tests}|.*/${tests})/[^/]+${testFile}`,
    packageNamespace: `^${escape(scope)}`,
    packageSourceRoot: `^${packages}/[^/]+/src/`,
    adapterCode: [
      `^${packages}/[^/]+/${adapters}(?:/|$)`,
      ...(adapterPackages.length ? [`^${packages}/(?:${adapterPackages.join("|")})/`] : []),
    ],
    adapterImports: adapterImportsOption(
      settings.adapterImports ?? DEFAULT_ADAPTER_IMPORTS,
      scope,
      packages,
    ),
  };
}

function rule(name, from, to) {
  return { name, severity: "error", comment: seeRuleLine(name), from, to };
}

// A module rule reports the file itself. A dependency rule would miss a file that imports nothing,
// or only excluded node_modules packages. `numberOfDependentsLessThan: 100` stands in for "every module".
function moduleRule(name, module) {
  return {
    name,
    severity: "error",
    comment: seeRuleLine(name),
    module: { ...module, numberOfDependentsLessThan: 100 },
    from: {},
  };
}

// Returns a whole dependency-cruiser configuration. Append project rules to the returned `forbidden` array.
function layout(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("layout(): options must be an object.");
  }
  const p = patterns(options);
  return {
    forbidden: [
      rule("no-cycles", {}, { circular: true }),
      rule("packages-do-not-import-apps", { path: p.packagesRoot }, { path: p.appsRoot }),
      rule(
        "apps-do-not-import-other-apps",
        { path: p.appRoot },
        { path: p.appsRoot, pathNot: "^$1/" },
      ),
      rule(
        "packages-imported-by-name",
        { path: p.workspaceRoot },
        { path: p.packagesRoot, pathNot: "^$1/", dependencyTypes: ["local"] },
      ),
      rule(
        "packages-public-entry-only",
        { path: p.workspaceRoot },
        { path: `${p.packagesRoot}[^/]+/(?!${p.publicEntry})`, pathNot: "^$1/" },
      ),
      rule("delivery-does-not-import-server", { path: p.deliveryRoot }, { path: p.serverRoot }),
      rule("server-does-not-import-delivery", { path: p.serverRoot }, { path: p.deliveryRoot }),
      rule(
        "use-cases-do-not-import-outer-layers",
        { path: p.useCasesRoot },
        { path: [p.deliveryRoot, p.serverRoot] },
      ),
      rule(
        "no-unresolved-deep-package-imports",
        {},
        { path: `${p.packageNamespace}[^/]+/.+`, couldNotResolve: true },
      ),
      rule(
        "production-does-not-import-tests",
        { path: p.sourceRoot, pathNot: p.testPath },
        { path: p.testPath },
      ),
      moduleRule("tests-live-in-tests-dir", { path: p.testFile, pathNot: p.testFileInTestsDir }),
      rule("tests-do-not-import-internals", { path: p.testPath }, { path: p.internalRoot }),
      rule("no-unresolved-imports", {}, { couldNotResolve: true }),
      moduleRule("app-code-in-layers", {
        path: p.appSource,
        pathNot: [...p.appLayerOrEntry, p.testPath],
      }),
      // $1 is the importing use-case's top-level entry under use-cases/, a file or a folder.
      rule(
        "use-cases-do-not-import-use-cases",
        { path: p.useCaseEntry, pathNot: p.testPath },
        { path: p.useCaseAny, pathNot: ["^$1(?:/|$)", p.testPath] },
      ),
      moduleRule("no-ownerless-files", { path: p.ownerlessPath }),
      moduleRule("package-root-files", {
        path: p.packageRootFile,
        pathNot: [p.packageRootFileAllowed, p.testPath],
      }),
      rule(
        "domain-does-not-import-adapters",
        { path: p.packageCode, pathNot: p.adapterImporters },
        { path: p.ownAdapters, pathNot: p.ownAdapterTests },
      ),
      rule(
        "domain-does-not-import-adapters",
        { path: p.packageCode, pathNot: [...p.adapterImporters, p.testPath] },
        { path: p.ownAdapterTests },
      ),
      // A subject reaches another subject directly, never through the package's own index.ts or
      // facade.ts: that barrel re-exports every subject, so it would hide a cycle from the
      // subject-folder check. storage.ts stays importable.
      rule(
        "subjects-do-not-import-package-root",
        {
          path: p.subjectFile,
          pathNot: [...p.notSubjectFolder.slice(1), p.testPath],
        },
        { path: p.ownRootBarrel },
      ),
      // Domain code names its storage port; only an adapter imports SQL or platform packages.
      // A listed workspace package gets its own rule, with an exact exception for its own folder,
      // so it may import its own files and no other package's folder can pass for it.
      rule(
        "adapter-imports-only-in-adapters",
        { path: p.packageSourceRoot, pathNot: p.adapterCode },
        { path: p.adapterImports.installed },
      ),
      ...p.adapterImports.workspace.map(({ folder, path }) =>
        rule(
          "adapter-imports-only-in-adapters",
          { path: p.packageSourceRoot, pathNot: [...p.adapterCode, folder] },
          { path },
        ),
      ),
    ],
    options: {
      parser: "swc",
      exclude: { path: EXCLUDED_PATH },
      doNotFollow: { path: "(?:^|/)node_modules(?:/|$)" },
      skipAnalysisNotInRules: true,
      tsPreCompilationDeps: "specify",
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["import", "require", "node", "default"],
      },
    },
  };
}

function subjectFolderPatterns(config) {
  const rules = config?.forbidden;
  const sourceRule = rules?.find(({ name }) => name === "domain-does-not-import-adapters");
  const testRule = rules?.find(({ name }) => name === "production-does-not-import-tests");
  const packageMatch = sourceRule?.from?.path?.match(/^\^\((.*)\)\/src\//u);
  const adapterPath = sourceRule?.to?.path;
  if (!packageMatch || typeof adapterPath !== "string" || typeof testRule?.to?.path !== "string") {
    throw new Error("layout config is missing subject-folder path patterns");
  }
  return {
    package: sourceRule.from.path,
    adapter: adapterPath.replace(/^\^\$1\//u, `^${packageMatch[1]}/`),
    test: testRule.to.path,
  };
}

module.exports = { layout, DEFAULT_ADAPTER_IMPORTS, subjectFolderPatterns };
