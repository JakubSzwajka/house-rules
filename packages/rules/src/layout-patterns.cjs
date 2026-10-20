"use strict";

const {
  adapterImportsOption,
  caseless,
  disjointRoots,
  escape,
  layerOptions,
  nameListOption,
  pathListOption,
  pathOption,
  rootsOption,
  scopeName,
} = require("./layout-option-parsers.cjs");
const { hostOption } = require("./hosts.cjs");

const DEFAULTS = {
  appsDir: "apps",
  packagesDir: "packages",
  publicEntry: "src/index.ts",
  internalDir: "src/internal",
  adaptersDir: "src/adapters",
  facadeFile: "src/facade.ts",
  testsDir: "tests",
};
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
// Empty by default, so a layout that names none keeps the rule's 0.11.0 shape.
const DEFAULT_PATH_LISTS = { generatedDeclarationFiles: [] };
const DECLARATION_FILE = /[.]d[.][cm]?ts$/u;
const DEFAULT_ADAPTER_IMPORTS = Object.freeze([
  "effect/unstable/sql",
  "effect/sql",
  "@effect/sql-*",
  "@effect/platform-*",
]);
const OPTION_NAMES = new Set([
  "scope",
  "host",
  "layers",
  "adapterImports",
  "trustedContractPackages",
  ...Object.keys(DEFAULTS),
  ...Object.keys(DEFAULT_NAME_LISTS),
  ...Object.keys(DEFAULT_PATH_LISTS),
]);
const BUILT_IN_TEST_DIRS = new Set(["test", "tests", "__tests__"]);
// Fixed on purpose: the one extra entry a package may declare, as "./contract" in its exports.
const CONTRACT_ENTRY = "src/contract[.]ts";
// An installed contract entry is the source file, from a git dependency, or its build in dist/, from
// the registry. node_modules is never followed, so it is trusted by name only. The framework's own is
// checked as a workspace file in its repo, and its browser bundle is tested there.
const INSTALLED_CONTRACT_ENTRY = `(?:${CONTRACT_ENTRY}|dist/contract[.](?:js|d[.]ts))`;
const TRUSTED_CONTRACT_PACKAGES = Object.freeze([
  "@house-rules/application",
  "@house-rules/domain",
  "@house-rules/identity",
]);
// The effect modules a contract entry may import: the root barrel, its stable top-level modules, and
// http (unstable/http on RCs). Their installed import graphs are unseen here; trust is explicit.
const EFFECT_BROWSER_MODULES =
  "(?:index|[A-Z][A-Za-z0-9]*|(?:http|unstable/http)/(?:index|[A-Z][A-Za-z0-9]*))[.]js";
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

function trustedContractPackagesOption(names) {
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string" || !PACKAGE_NAME.test(name))
  ) {
    throw new TypeError(
      'layout(): trustedContractPackages must be an array of package names, such as "@acme/catalogue".',
    );
  }
  return [...TRUSTED_CONTRACT_PACKAGES, ...names].map(escape);
}

const REMOVED_OPTIONS = {
  adapterImportsSeverity:
    "layout(): adapterImportsSeverity was removed in 0.8.0. adapter-imports-only-in-adapters is always an error: move the import into an adapter, or name the package in adapterPackages.",
  serverEntryFiles:
    "layout(): serverEntryFiles was removed in 0.16.0. Put root wiring in src/composition/ as composition({ layer, entries, ways, system, gatePolicy }); ways may import the root, and main.ts passes way values into it. Use toFetchHandler for the router. Remove the option. See @house-rules/rules docs/dependency-cruiser.md.",
};

const unique = (values) => [...new Set(values)];

function patterns(options) {
  for (const [name, message] of Object.entries(REMOVED_OPTIONS)) {
    if (Object.hasOwn(options, name)) throw new TypeError(message);
  }
  const unknown = Object.keys(options).filter((name) => !OPTION_NAMES.has(name));
  if (unknown.length) {
    throw new TypeError(
      `layout(): unknown option "${unknown[0]}". Known options: ${[...OPTION_NAMES].join(", ")}.`,
    );
  }
  const settings = { ...DEFAULTS, ...options };
  const host = hostOption(settings.host, "layout()");
  const scope = scopeName(settings.scope);
  const appRoots = rootsOption(settings.appsDir, "appsDir");
  const packageRoots = rootsOption(settings.packagesDir, "packagesDir");
  disjointRoots(appRoots, packageRoots);
  const apps = appRoots.pattern;
  const packages = packageRoots.pattern;
  const tests = pathOption(settings.testsDir, "testsDir");
  const layers = layerOptions(settings.layers ?? {}, host ? { waysIn: host.waysInLayer } : {});
  const layerRoot = (layer) => `^${apps}/[^/]+/src/${layer}(?:/|$)`;
  // A host app has only its host's entry files, so the generic main.ts and index.ts stay out unless named.
  const ownEntryFiles = settings.appEntryFiles ?? (host ? [] : DEFAULT_NAME_LISTS.appEntryFiles);
  const entryFiles = unique([
    ...nameListOption(ownEntryFiles, "appEntryFiles", { allowEmpty: true }),
    ...(host ? host.appEntryFiles.map(escape) : []),
  ]);
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
  const declarationFiles =
    settings.generatedDeclarationFiles ?? DEFAULT_PATH_LISTS.generatedDeclarationFiles;
  const declarations = pathListOption(
    Array.isArray(declarationFiles) && host
      ? unique([...declarationFiles, ...host.generatedDeclarationFiles])
      : declarationFiles,
    "generatedDeclarationFiles",
    (entry) => DECLARATION_FILE.test(entry),
    ', each ending in ".d.ts", ".d.mts" or ".d.cts"',
  );

  const publicEntry = pathOption(settings.publicEntry, "publicEntry");
  const facadeFile = pathOption(settings.facadeFile, "facadeFile");
  const trustedContracts = trustedContractPackagesOption(settings.trustedContractPackages ?? []);
  const adapterImports = adapterImportsOption(
    settings.adapterImports ?? DEFAULT_ADAPTER_IMPORTS,
    scope,
    packages,
  );

  return {
    appsRoot: `^${apps}/`,
    packagesRoot: `^${packages}/`,
    workspaceRoot: `^((?:${apps}|${packages})/[^/]+)/`,
    appRoot: `^(${apps}/[^/]+)/`,
    sourceRoot: `^(?:${apps}|${packages})/[^/]+/src(?:/|$)`,
    publicEntry: `${publicEntry}$`,
    publicEntries: `(?:${publicEntry}|${CONTRACT_ENTRY})$`,
    contractEntry: `^${packages}/[^/]+/${CONTRACT_ENTRY}$`,
    appDescriptorEntry: `(?:^${apps}/[^/]+/src/${layers.readModels}/[^/]+/contract[.]ts$|^${apps}/[^/]+/src/${layers.features}/[^/]+/(?:node|entry)[.]ts$|^${apps}/[^/]+/src/${layers.waysIn}/[^/]+/endpoints[.]ts$)`,
    // Safe-regex counts `?` on a group as nesting, so optional groups are written `(?:x|)`.
    // The browser-safe set: workspace domain files and contract entries, which the rule follows, the
    // allowlisted effect modules, and the trusted installed contract entries. Anything else is refused.
    browserSafe: [
      `^${apps}/[^/]+/src/${layers.features}/[^/]+/(?:node|entry)[.]ts$`,
      `^${apps}/[^/]+/src/${layers.waysIn}/[^/]+/endpoints[.]ts$`,
      `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/(?!adapters/|(?:index|facade|storage)[.]ts$|(?:.*/|)(?:${testDirs})/|.*${testFile}).+`,
      `^${packages}/[^/]+/(?!${adapters}(?:/|$)|(?:${publicEntry}|${facadeFile}|src/storage[.]ts)$|src/(?:.*/|)(?:${testDirs})/|.*${testFile})src/`,
      `(?:^|/)node_modules/effect/dist/${EFFECT_BROWSER_MODULES}$`,
      `(?:^|/)node_modules/(?:${trustedContracts.join("|")})/${INSTALLED_CONTRACT_ENTRY}$`,
    ],
    internalRoot: `^${packages}/[^/]+/${pathOption(settings.internalDir, "internalDir")}(?:/|$)`,
    featuresRoot: layerRoot(layers.features),
    readModelsRoot: layerRoot(layers.readModels),
    waysInRoot: layerRoot(layers.waysIn),
    waysInImporter: `^(${apps}/[^/]+/src)/${layers.waysIn}(?:/|$)`,
    waysInValues: [
      `^$1/(?:${layers.features}|${layers.composition}|${layers.waysIn})/`,
      `^${packages}/[^/]+/${CONTRACT_ENTRY}$`,
      `^${packages}/(?:application|domain)/${publicEntry}$`,
      `(?:^|/)node_modules/(?:@[^/]+/|)[^/]+/${INSTALLED_CONTRACT_ENTRY}$`,
      `(?:^|/)node_modules/@house-rules/(?:application|domain)/(?:src/index[.]ts|dist/index[.](?:js|d[.]ts))$`,
      "(?:^|/)node_modules/effect/",
    ],
    featureFolder: `^(${apps}/[^/]+/src/${layers.features}/[^/]+)/`,
    readModelFolder: `^(${apps}/[^/]+/src/${layers.readModels}/[^/]+)/`,
    wayFolder: `^(${apps}/[^/]+/src/${layers.waysIn}/[^/]+)/`,
    folderCode: `^(${apps}/[^/]+/src/${layers.readModels}/[^/]+)/`,
    folderSource: `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/`,
    folderAdapters: `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/adapters/`,
    folderAdapterImporters: `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/(?:adapters/|(?:index|facade)[.]ts$)`,
    folderRootFile: `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/[^/]+$`,
    folderRootFileAllowed: `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/(?:${rootFiles.join("|")}|contract[.]ts)$`,
    folderSubject: `^(${apps}/[^/]+/src/${layers.readModels}/[^/]+)/(?!adapters/|(?:${testDirs})/)[^/]+/`,
    domainPackage: `^${packages}/domain/src/`,
    houseRulesImport: `(?:^@house-rules/|(?:^|/)node_modules/@house-rules/|^${packages}/(?!domain/)[^/]+/)`,
    compositionRoot: layerRoot(layers.composition),
    appFolder: `^${apps}/[^/]+/`,
    // null when no file is named, so the rule keeps its 0.11.0 shape.
    generatedDeclaration: declarations && `^${apps}/[^/]+/${declarations}$`,
    appSource: `^${apps}/[^/]+/src/`,
    appLayerOrEntry: [
      `^${apps}/[^/]+/src/(?:${Object.values(layers).join("|")})/`,
      ...(entryFiles.length ? [`^${apps}/[^/]+/src/(?:${entryFiles.join("|")})$`] : []),
    ],
    ownerlessPath: [
      `^(?:${apps}|${packages})/(?:.*/)?(?:${ownerless.join("|")})(?:[.][^/]*)?(?:/|$)`,
      ...(mechanism.length
        ? [
            `^${packages}/[^/]+/(?:.*/)?(?:${mechanism.join("|")})(?:[.][^/]*)?(?:/|$)`,
            `^${apps}/[^/]+/src/${layers.readModels}/[^/]+/(?:.*/)?(?:${mechanism.join("|")})(?:[.][^/]*)?(?:/|$)`,
          ]
        : []),
    ],
    packageRootFile: `^${packages}/[^/]+/src/[^/]+$`,
    packageRootFileAllowed: `^${packages}/[^/]+/src/(?:${rootFiles.join("|")})$`,
    contractEntryFile: `^${packages}/[^/]+/${CONTRACT_ENTRY}$`,
    // $1 is the package folder. Only the public entry and the facade wire the package's own adapters.
    packageCode: `^(${packages}/[^/]+)/src/`,
    adapterImporters: [
      `^${packages}/[^/]+/${adapters}(?:/|$)`,
      `^${packages}/[^/]+/${publicEntry}$`,
      `^${packages}/[^/]+/${facadeFile}$`,
    ],
    ownAdapters: `^$1/${adapters}(?:/|$)`,
    ownAdapterTests: `^$1/${adapters}/tests(?:/|$)`,
    // A file in a subject folder, and the package's own root barrel ($1 is the package folder).
    subjectFile: `^(${packages}/[^/]+)/src/[^/]+/`,
    ownRootBarrel: `^$1/(?:${publicEntry}|${facadeFile}|${CONTRACT_ENTRY})$`,
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
    adapterImports,
    buildOutputFolders: host ? host.buildOutputFolders.map(escape) : [],
  };
}

module.exports = { DEFAULT_ADAPTER_IMPORTS, patterns };
