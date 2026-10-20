# Testing exports only in tests rule

Rule ID: `house-rules/testing-exports-only-in-tests`

A package may export helpers for tests, such as `MigrationsTesting` from `@house-rules/migrations`, which gives each test file a throwaway database. Such an export's name ends in `Testing`. It is for tests. Production code that imports one can reach testing-only behavior, such as test setup or a read that exists only for tests, and every other check stays green. The rule reports that use. Enable it with `plugin.configs.testing`, a one-rule preset that runs it on every JS and TS file. `plugin.configs.nodes` includes it; `plugin.configs.recommended` does not.

A test file may import a testing export. A test file is any file under a `tests/`, `test/`, or `__tests__/` folder, or named `*.test.*` or `*.spec.*`. These are the same test paths Dependency Cruiser and the migrations bin treat as tests. A layout with a custom `testsDir` passes the same name to this rule, as the `testsDir` option below.

```ts
// apps/web/src/features/show/tests/support.ts: passes, a test file
import { MigrationsTesting } from "@house-rules/migrations";

// apps/web/src/composition/event-dispatcher.ts: reported
import { EventLogTesting } from "@acme/event-log";
```

The message is `EventLogTesting is a testing export. Import it only in a test file (under tests/, test/ or __tests__/, or named *.test.* or *.spec.*), or in testing code whose runtime exports are all named *Testing.`

## What the rule checks

In a file that is not a test file and not testing code, it reports a name that ends in `Testing` and comes from another module:

- a named import, also renamed (`import { DbTesting as TestDb } from "@acme/db"`), or a relative one (`from "../index.ts"`);
- a member of a module object (`Db.DbTesting`, `Db["DbTesting"]`, `(Db as typeof Db).DbTesting`), or a destructured one (`const { DbTesting } = Db`, `({ DbTesting: x } = Db)`). A module object is `import * as Db`, `await import("@acme/db")` with a literal path, an unshadowed `require("@acme/db")`, TypeScript's `import Db = require("@acme/db")`, or a `const` or `import alias = Db` alias of one of them;
- a TypeScript import alias of a module object's member, exported or not: `import live = Db.DbTesting`, `export import live = Db.DbTesting`;
- a re-export by package name (`export { DbTesting } from "@acme/db"`), also renamed.

It reads the name the module exports, not the local name, so `import { Db as DbTesting }` passes and `import { DbTesting as TestDb }` is reported.

## Testing code builds on testing code

A db package can build `DbTesting` on `MigrationsTesting`. The file that does is **testing code**, and may use testing exports, when both hold:

- every runtime export it has is named `*Testing`: no default export, no `export *` or `export * as`, no `export =`, and no value export under another name;
- at least one of those exports is a value the file declares: `export const DbTesting = ...` (destructuring counts: `export const { DbTesting } = ...`), `export function`, `export class`, or `export { build as DbTesting }`.

Type exports, interfaces and `declare` values run nothing, so they neither make a file testing code nor stop it from being one. Neither does `export { X }` of a local name declared only as a type.

A TypeScript namespace counts by what TypeScript compiles it to. A namespace that holds only types, non-exported import aliases, and namespaces like it is erased, as is a `declare namespace`, so it counts neither way: `export namespace XTesting { export type Marker = string }` does not make a file testing code, and `export namespace Options { export type Marker = string }` does not stop one. Any other namespace is a value export under its name, the leftmost one for `namespace A.B`. `export import XTesting = Db.y` passes a value on, like `export { MigrationsTesting }`, so it does not make a file testing code on its own. Passing on an import (`import { MigrationsTesting } ...; export { MigrationsTesting }`) is allowed in testing code but does not make a file testing code on its own.

A file that mixes production and testing exports gets no waiver. This fails, because `live` is not named `*Testing`:

```ts
// packages/db/src/bridge.ts: reported
import { DbTesting } from "./real.ts";
export const XTesting = {};
export const live = DbTesting;
```

A package index publishes its own testing export by path, under a `*Testing` name: `export { MigrationsTesting } from "./test-database/test-database.ts"` and `export { MigrationsTesting as DbMigrationsTesting } from "./test-database/test-database.ts"` pass. A re-export by path under another name, such as `export { DbTesting as live } from "./db.ts"`, is reported, because whoever imports `live` would not be checked.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `testsDir` | none | One more folder that holds test files, with the meaning `layout()`'s `testsDir` has in [the Dependency Cruiser preset](dependency-cruiser.md): a relative path with no leading or trailing `/`, such as `"spec"`. A file under it is a test file, next to `tests/`, `test/`, and `__tests__/`, and the message names it. |

A layout that sets `testsDir: "spec"` sets the same value here, after the preset:

```js
export default [
  ...houseRules.configs.nodes,
  { rules: { "house-rules/testing-exports-only-in-tests": ["error", { testsDir: "spec" }] } },
];
```

Type-only imports and re-exports pass, since they run nothing.

## Upgrading to 0.13.1

Nothing to change. 0.13.1 adds the `testsDir` option. Without it the rule behaves as in 0.13.0.

## Upgrading to 0.13.0

The rule is new in 0.13.0. It is on in `configs.nodes` and in the new `configs.testing`, and off in `configs.recommended`. A production file that uses a `*Testing` name now fails. Move the code that needs it into a test folder, or, when it builds a testing helper, make the file testing code: export the helper under a `*Testing` name, and export nothing else at runtime. For example, a `packages/db/src/test-database/testing.ts` that imports `MigrationsTesting` and exports `makeDbTestingLayer` fails. It passes once it exports `DbTesting` in place of `makeDbTestingLayer`, or moves into a test folder.

## Limits

The rule checks static names in one file at a time. It does not track data flow between files or module side effects, so the closed chain holds only as far as the names go:

- A testing export whose name does not end in `Testing` is not seen.
- Testing code may still hand a helper on through something other than an export name, such as a mutable object, a global, or a function that returns it.
- A re-export of a whole module passes: `export * from "@acme/db"`, `export * as Live from "@acme/db"`, and `export const Live = Db` after `import * as Db`. Knowing whether such a module carries testing exports needs module resolution. A file that does this is not testing code, though, so it cannot also use a testing export directly.
- It does not follow `import()` with a computed path (`import(require.resolve("@acme/db"))`), `require` bound to a local (`const require = createRequire(...)`), `import("@acme/db").then(...)`, a `let` alias, a parameter, a module object returned from a function, a default import's members, or `module.exports`.
- A namespace is a value when TypeScript emits its object, even an empty one: a `declare const` or a `const enum` inside a non-`declare` namespace makes it a value, as TypeScript does under `isolatedModules`. Another compiler that erases such a namespace leaves a file the rule took for testing code with no `*Testing` value.
- It does not read the Dependency Cruiser config. A custom `testsDir` there reaches this rule only when the ESLint config passes the same value as the `testsDir` option.
- The migrations bin (`house-rules-migrations`) ignores a custom `testsDir`. It still counts only `test/`, `tests/`, `__tests__/`, and `*.test.*` or `*.spec.*` files as tests, so a module file under a custom folder such as `spec/` that calls `UnitOfWork.atomic` still fails there.
