"use strict";

const {
  adapterImportsOption,
  caseless,
  disjointRoots,
  escape,
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
  testsDir: "tests",
};
const DEFAULT_NAME_LISTS = {
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
  packageRootFiles: ["index.ts"],
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
  "adapterImports",
  ...Object.keys(DEFAULTS),
  ...Object.keys(DEFAULT_NAME_LISTS),
  ...Object.keys(DEFAULT_PATH_LISTS),
]);
const BUILT_IN_TEST_DIRS = new Set(["test", "tests", "__tests__"]);

const RETIRED_KITS =
  "with the retired house-rules kits. Apps build on Alchemy Domain, which has no app areas, facades or contract doors. Remove the option.";
const REMOVED_OPTIONS = {
  adapterImportsSeverity:
    "layout(): adapterImportsSeverity was removed in 0.8.0. adapter-imports-only-in-adapters is always an error: move the import into an adapter, or name the package in adapterPackages.",
  serverEntryFiles:
    "layout(): serverEntryFiles was removed in 0.16.0. Remove the option. See @house-rules/rules docs/dependency-cruiser.md.",
  layers: `layout(): layers was removed ${RETIRED_KITS}`,
  appEntryFiles: `layout(): appEntryFiles was removed ${RETIRED_KITS}`,
  facadeFile: `layout(): facadeFile was removed ${RETIRED_KITS}`,
  trustedContractPackages: `layout(): trustedContractPackages was removed ${RETIRED_KITS}`,
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
    internalRoot: `^${packages}/[^/]+/${pathOption(settings.internalDir, "internalDir")}(?:/|$)`,
    // null when no file is named, so the rule keeps its 0.11.0 shape.
    generatedDeclaration: declarations && `^${apps}/[^/]+/${declarations}$`,
    ownerlessPath: [
      `^(?:${apps}|${packages})/(?:.*/)?(?:${ownerless.join("|")})(?:[.][^/]*)?(?:/|$)`,
      ...(mechanism.length
        ? [`^${packages}/[^/]+/(?:.*/)?(?:${mechanism.join("|")})(?:[.][^/]*)?(?:/|$)`]
        : []),
    ],
    packageRootFile: `^${packages}/[^/]+/src/[^/]+$`,
    packageRootFileAllowed: `^${packages}/[^/]+/src/(?:${rootFiles.join("|")})$`,
    // $1 is the package folder. Only the public entry wires the package's own adapters.
    packageCode: `^(${packages}/[^/]+)/src/`,
    adapterImporters: [
      `^${packages}/[^/]+/${adapters}(?:/|$)`,
      `^${packages}/[^/]+/${publicEntry}$`,
    ],
    ownAdapters: `^$1/${adapters}(?:/|$)`,
    ownAdapterTests: `^$1/${adapters}/tests(?:/|$)`,
    // A file in a subject folder, and the package's own root barrel ($1 is the package folder).
    subjectFile: `^(${packages}/[^/]+)/src/[^/]+/`,
    ownRootBarrel: `^$1/${publicEntry}$`,
    notSubjectFolder: [
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
