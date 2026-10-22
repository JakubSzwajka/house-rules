"use strict";

const { DEFAULT_ADAPTER_IMPORTS, patterns } = require("./layout-patterns.cjs");

// This preset loads only its sibling files in src/, so it carries its own copy of the link. A rule name
// is its README id and already a valid anchor; tests/rule-docs.test.mjs checks each comment against src/rule-docs.mjs.
const seeRuleLine = (name) => `See https://stack.kubaszwajka.com/rules/#${name}`;

// node_modules is not followed, but stays in the graph, so a rule can see which package a file imports.
// A host adds its build output, such as Next's `.next`.
const excludedPath = (buildOutputFolders) =>
  `^(?!.*node_modules/)(?:|.*/)(?:${["dist", "coverage", "generated", "[.]turbo", "[.]agent_sources", ...buildOutputFolders].join("|")})(?:/|$)`;

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
        { path: `${p.packagesRoot}[^/]+/(?!${p.publicEntries})`, pathNot: "^$1/" },
      ),
      // A contract entry is what a browser bundle loads, so everything it reaches must be browser-safe.
      rule(
        "contract-entry-is-browser-safe",
        { path: p.contractEntry },
        {
          reachable: true,
          pathNot: p.browserSafe,
        },
      ),
      rule(
        "features-do-not-import-outer-folders",
        { path: p.featureFolder, pathNot: p.testPath },
        { path: [p.waysInRoot, p.compositionRoot], reachable: true },
      ),
      rule(
        "read-models-import-packages-only",
        { path: p.readModelFolder, pathNot: p.testPath },
        { path: p.appFolder, pathNot: "^$1/" },
      ),
      rule(
        "ways-in-import-app-folders-only",
        { path: p.waysInRoot, pathNot: p.testPath },
        {
          path: p.appFolder,
          pathNot: [p.waysInRoot, p.featuresRoot, p.compositionRoot, p.readModelsRoot],
        },
      ),
      rule(
        "ways-in-do-not-import-read-model-values",
        { path: p.waysInRoot, pathNot: p.testPath },
        { path: p.readModelsRoot, dependencyTypesNot: ["type-only"] },
      ),
      // Check every way file, including barrels. Do not follow composition into its captured services.
      rule(
        "ways-in-import-contracts-only",
        { path: p.waysInImporter, pathNot: [p.testPath, p.waysInPage] },
        { pathNot: p.waysInValues, dependencyTypesNot: ["type-only"] },
      ),
      rule(
        "ways-in-import-contracts-only",
        { path: p.waysInPage, pathNot: p.testPath },
        { pathNot: [...p.waysInValues, p.waysInThirdParty], dependencyTypesNot: ["type-only"] },
      ),
      rule(
        "ways-in-do-not-import-other-ways",
        { path: p.wayFolder, pathNot: p.testPath },
        { path: p.waysInRoot, pathNot: "^$1/", reachable: true },
      ),
      rule(
        "composition-does-not-import-ways-in",
        { path: p.compositionRoot },
        { path: p.waysInRoot, reachable: true },
      ),
      rule(
        "read-models-public-entry-only",
        { path: `(?:${p.folderCode}|^)` },
        { path: `${p.folderSource}(?!(?:index|contract)[.]ts$)`, pathNot: "^$1/" },
      ),
      rule(
        "domain-imports-no-house-rules",
        { path: p.domainPackage },
        { path: p.houseRulesImport },
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
      // A generated declaration file references build output that does not exist before the build.
      rule(
        "no-unresolved-imports",
        p.generatedDeclaration ? { pathNot: p.generatedDeclaration } : {},
        { couldNotResolve: true },
      ),
      moduleRule("app-folders", {
        path: p.appSource,
        pathNot: [...p.appLayerOrEntry, p.testPath],
      }),
      moduleRule("no-ownerless-files", { path: p.ownerlessPath }),
      moduleRule("package-root-files", {
        path: p.folderRootFile,
        pathNot: [p.folderRootFileAllowed, p.testPath],
      }),
      moduleRule("package-root-files", {
        path: p.packageRootFile,
        pathNot: [p.packageRootFileAllowed, p.testPath, p.contractEntryFile],
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
      rule(
        "contract-entry-is-browser-safe",
        { path: p.appDescriptorEntry },
        { reachable: true, pathNot: p.browserSafe },
      ),
      rule(
        "domain-does-not-import-adapters",
        { path: p.folderCode, pathNot: p.folderAdapterImporters },
        { path: "^$1/adapters/", pathNot: "^$1/adapters/tests/" },
      ),
      rule(
        "domain-does-not-import-adapters",
        { path: p.folderCode, pathNot: [p.folderAdapterImporters, p.testPath] },
        { path: "^$1/adapters/tests/" },
      ),
      rule(
        "subjects-do-not-import-package-root",
        { path: p.folderSubject, pathNot: p.testPath },
        { path: "^$1/(?:index|facade|contract)[.]ts$" },
      ),
      rule(
        "adapter-imports-only-in-adapters",
        { path: p.folderSource, pathNot: p.folderAdapters },
        { path: p.adapterImports.installed },
      ),
      ...p.adapterImports.workspace.map(({ path }) =>
        rule(
          "adapter-imports-only-in-adapters",
          { path: p.folderSource, pathNot: p.folderAdapters },
          { path },
        ),
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
      exclude: { path: excludedPath(p.buildOutputFolders) },
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
  const sourceRule = rules?.find(
    ({ name, from }) =>
      name === "domain-does-not-import-adapters" && /^\^\((.*)\)\/src\//u.test(from.path),
  );
  const testRule = rules?.find(({ name }) => name === "production-does-not-import-tests");
  const packageMatch = sourceRule?.from?.path?.match(/^\^\((.*)\)\/src\//u);
  const adapterPath = sourceRule?.to?.path;
  if (!packageMatch || typeof adapterPath !== "string" || typeof testRule?.to?.path !== "string") {
    throw new Error("layout config is missing subject-folder path patterns");
  }
  return {
    package: sourceRule.from.path,
    folder: rules.find(
      ({ name, from }) =>
        name === "domain-does-not-import-adapters" && from.path !== sourceRule.from.path,
    )?.from.path,
    adapter: adapterPath.replace(/^\^\$1\//u, `^${packageMatch[1]}/`),
    test: testRule.to.path,
  };
}

module.exports = { layout, DEFAULT_ADAPTER_IMPORTS, subjectFolderPatterns };
