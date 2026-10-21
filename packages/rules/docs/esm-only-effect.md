# esm-only-effect

Production app src and Effect workspace-package src use ESM imports. This includes the domain and application kits. Enable the rule through configs.features or featuresConfig with the same appsDir/packagesDir roots as layout.

## Scope

App roots select app source. Package metadata selects Effect workspaces through an effect dependency, devDependency or peerDependency, an effect tsconfig preset, or a kit package name. Only this resolved rules package root with its matching name, and tooling outside src, are excluded. A different package named @house-rules/rules gets no exemption. Test conventions are relative to the owner's src, not the checkout's absolute path or a workspace named test/tests.

The rule rejects references to free require, module.require and createRequire imported from node:module or module. Aliases, mutable bindings, sequence/call forms and named/default/namespace imports cannot turn those origins into allowed loaders. Unrelated local require/createRequire names and object properties are not CommonJS loaders. Relative, tooling and workspace-package loader barrels retain createRequire identity. Literal dynamic imports of node:module/module and destructured module.require also fail. Other node:module ESM APIs remain available through static imports.

## Builder checks and limits

feature-builders remains separate. It checks builder identity in plain non-Effect workspace packages, including kit named/star re-exports through relative and workspace doors. Installed non-workspace npm re-export contents are not inspected. The three older probe misses remain two singular test/ convention exemptions and one installed npm re-export, not supported builder APIs.

This is a static import/reference check, not a JavaScript evaluator. Reflective access to builtins, runtime code generation and computed property names are not proven safe. They remain forbidden CommonJS loading under the law even when this rule cannot identify their origin. ESM imports of legacy .cjs files are not classified as CommonJS loader calls. Use direct ESM imports.
