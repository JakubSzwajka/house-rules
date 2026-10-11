# TypeScript presets

Import paths:

- `@house-rules/rules/tsconfig/strict.json`: compiler flags only.
- `@house-rules/rules/tsconfig/effect.json`: extends `strict.json` and adds the `@effect/language-service` plugin block.
- `@house-rules/rules/tsconfig/web.json`: extends `strict.json` for UI code a bundler builds: DOM libs and bundler resolution, no plugin block. Since 0.12.0. See [web.json](#webjson).

`strict.json` and `effect.json` come from drunk-cat-stack's `tsconfig.base.json`. Merged, they equal it exactly. A test checks that against the copy in `tests/fixtures/presets/`.

```json
// tsconfig.base.json
{
  "extends": "@house-rules/rules/tsconfig/effect.json"
}
```

Each workspace keeps its own `tsconfig.json` with `include` and anything project-specific, such as `"jsx": "preserve"`, and extends the base file as before.

## strict.json

`target` and `lib` ES2023, `module` and `moduleResolution` NodeNext, `moduleDetection: "force"`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `noEmit`. NodeNext needs `"type": "module"` in the consumer's `package.json`, or `.mts` files.

## effect.json

Adds one `plugins` entry for `@effect/language-service`, with `namespaceImportPackages: ["effect"]` and every diagnostic severity as drunk-cat-stack sets it: most at `error`, and `importFromBarrel`, `strictEffectProvide`, `lazyEffect` and `strictBooleanExpressions` off. The diagnostics only run in a compiler patched by `@effect/tsgo` (`effect-tsgo patch`). A plain `tsc` ignores the block.

`plugins` is an array, so a consumer that sets its own `compilerOptions.plugins` replaces the whole Effect block rather than adding to it.

## web.json

For a web app's UI code, built by a bundler: Next.js, Vite, Remix, Astro, or similar. It extends `strict.json` and changes three options:

| Option | `strict.json` | `web.json` |
| --- | --- | --- |
| `lib` | `["ES2023"]` | `["ES2023", "DOM", "DOM.Iterable"]` |
| `module` | `NodeNext` | `ESNext` |
| `moduleResolution` | `NodeNext` | `Bundler` |

Every strict flag stays. It has no `plugins` block, so a framework plugin such as `{ "name": "next" }` replaces nothing. It sets no `jsx`, `types` or `paths`: those depend on the framework, so the app sets them.

A web app splits its code across two tsconfig files:

- `tsconfig.json` checks the whole app as UI code. It extends `web.json` and adds the framework's values.
- `tsconfig.effect.json` checks the app's Effect code, `src/server/` and `src/use-cases/`. It extends `effect.json` first and `web.json` second, so the Effect diagnostics run with the same libs and resolution as the UI. Its `typecheck` script runs it with the patched `tsc`.

Order matters. In an `extends` array, a later file wins. `[effect.json, web.json]` keeps the plugin block, which only `effect.json` sets, and takes `web.json`'s libs and resolution. `packages/rules/tests/config-presets-effect.test.mjs` keeps this as a test: with the patched root `tsc`, DOM types resolve and a floating Effect still fails with TS377001. `[web.json, effect.json]` puts `strict.json`'s `NodeNext` and ES2023-only `lib` back, because `effect.json` extends `strict.json`.

Packages keep extending the root `tsconfig.base.json`, which extends `effect.json`. Neither app file sets `plugins` over an Effect block, so no file switches Effect diagnostics off.

Next.js:

```json
// apps/web/tsconfig.json
{
  "extends": "@house-rules/rules/tsconfig/web.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

```json
// apps/web/tsconfig.effect.json
{
  "extends": [
    "@house-rules/rules/tsconfig/effect.json",
    "@house-rules/rules/tsconfig/web.json"
  ],
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["src/server/**/*.ts", "src/use-cases/**/*.ts"]
}
```

Vite with React:

```json
// apps/web/tsconfig.json
{
  "extends": "@house-rules/rules/tsconfig/web.json",
  "compilerOptions": { "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src"]
}
```

```json
// apps/web/tsconfig.effect.json
{
  "extends": [
    "@house-rules/rules/tsconfig/effect.json",
    "@house-rules/rules/tsconfig/web.json"
  ],
  "include": ["src/server/**/*.ts", "src/use-cases/**/*.ts"]
}
```

```json
// apps/web/package.json
{
  "scripts": {
    "typecheck": "tsc --project tsconfig.json && tsc --project tsconfig.effect.json"
  }
}
```

An app with no Effect code needs only `tsconfig.json`.

## Resolution

TypeScript resolves the `extends` specifier through this package's `exports` map. That was checked with TypeScript 7.0.2: an export whose name differs from the file path still resolves, so it is the `exports` field doing the work, not a file-path fallback.

## Tested against

| Tool | Version |
| --- | --- |
| `typescript` | 7.0.2 (this repository installs it as the `typescript-7` alias, so the ESLint parser keeps its TypeScript 6 peer) |
| `@effect/tsgo` | 0.45.0 (proven in a drunk-cat-stack copy: a floating Effect fails with `TS377001 ... effect(floatingEffect)`; proven again for `[effect.json, web.json]` in 0.12.0, where a file that uses `document` and a floating Effect fails only on `floatingEffect`) |

`tsc --showConfig` omits `plugins`, so `tests/config-presets.test.mjs` checks the `[effect.json, web.json]` libs and resolution with plain TypeScript 7.0.2. `tests/config-presets-effect.test.mjs` checks the Effect diagnostics under that order with the patched root `tsc`.
