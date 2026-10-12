# shadcn preset

Entry point: `@house-rules/rules/shadcn`

[`@shadcn/lint`](https://github.com/shadcn-ui/lint) is an ESLint plugin for Tailwind v4 apps, written by the shadcn/ui team. It has six rules. They read class strings, `style` props and SVG colour attributes in JSX and TSX, and check them against the app's own components, variants and theme. The plugin reads the theme stylesheet and the files it imports, to learn the theme: tokens, scales and class names. It does not lint CSS declarations. The `shadcn()` factory in this package turns the plugin on with the setup its docs advise, so every app gets the same rules and the same component-folder override. It also turns on one house rule, `design-no-raw-element` (see `design-no-raw-element.md`), which reports a raw `<button>` or `<input>` where the component folder has a `Button` or an `Input`.

The preset is built for `@shadcn/lint` 0.2.0. Source references below point at its release tag, `@shadcn/lint@0.2.0`, which is commit [`a89d047`](https://github.com/shadcn-ui/lint/tree/a89d04792f340bcea26af2d539a9eec7285fcc77).

## Install

`@shadcn/lint` is an optional peer dependency, so pnpm does not install it. Add it to the app, pinned exactly:

```sh
pnpm add -D @shadcn/lint@0.2.0
```

Importing `@house-rules/rules/shadcn` without it fails with `ERR_MODULE_NOT_FOUND`. The parser, `@typescript-eslint/parser`, comes with `@house-rules/rules`, so the app does not add it.

Two more packages change what the plugin can see:

- `oxc-parser` is an optional dependency of `@shadcn/lint`. The plugin uses it to read component files for their variants. See "TypeScript 7" below.
- `tailwindcss` v4. `no-unknown-classes` asks the installed Tailwind which classes exist. Without it, the rule prints a warning once and falls back to a grammar bundled with the plugin. Most Tailwind apps have it already.

The plugin finds the components and the theme through the app's `components.json`. Without one, it looks in `components/ui` or `src/components/ui` and picks a stylesheet that imports Tailwind ([how-it-works.md](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/docs/how-it-works.md)). Use the `settings` option when the app's layout differs.

## Wire it up

```js
// eslint.config.mjs
import houseRules from "@house-rules/rules";
import design from "@house-rules/rules/design";
import shadcn from "@house-rules/rules/shadcn";

export default [
  ...houseRules.configs.recommended,
  ...design({ tokenFiles: ["apps/web/src/app/globals.css"] }),
  ...shadcn({
    files: ["apps/web/**/*.{jsx,tsx}"],
    components: ["apps/web/src/components/ui/**"],
  }),
];
```

`shadcn(options)` is the default and the named export. It returns two flat-config blocks, and a third with `host`:

1. The app block. It runs the six rules and `house-rules/design-no-raw-element` on `files`, with the same parser setup as `recommended`.
2. The component-folder block. It turns `no-restyle`, `no-arbitrary-values`, `require-static-classes` and `design-no-raw-element` off for files in `components` that the app block also lints.
3. The host block, only with `host`. It turns `no-inline-styles` and `design-no-raw-element` off for the host's shell-free files that the app block also lints. See [Next.js root error boundary](#nextjs-root-error-boundary).

## What it turns on

`@shadcn/lint` 0.2.0 ships no preset of its own ([src/index.ts](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/packages/lint/src/index.ts#L2)). The defaults copy the full setup in its adoption guide, [docs/adoption.md:104-137](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/docs/adoption.md#L104-L137):

| Rule | Default | Off in the component folder |
| --- | --- | --- |
| `shadcn/no-restyle` | `["error", { allow: ["layout"] }]` | yes |
| `shadcn/no-raw-colors` | `"error"` | no |
| `shadcn/no-arbitrary-values` | `["error", { allow: ["layout"] }]` | yes |
| `shadcn/no-inline-styles` | `"error"` | no |
| `shadcn/require-static-classes` | `"error"` | yes |
| `shadcn/no-unknown-classes` | `"warn"` | no |
| `house-rules/design-no-raw-element` | `["error", { components }]` | yes |

The component-folder override is the one in [docs/adoption.md:118-133](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/docs/adoption.md#L118-L133). Components own their look, so they may set padding or `ring-[3px]`. `no-raw-colors` and `no-inline-styles` stay on inside the folder. `design-no-raw-element` is off there too, because a `Button` renders a `<button>`.

`design-no-raw-element` is not part of `@shadcn/lint`. The factory passes it the `components` globs, and the rule reads the file names there to learn which components exist. The default map covers `button`, `input`, `textarea`, `select`, `table` and `dialog`; `<a>` is opt-in, because the link component belongs to the framework. See `design-no-raw-element.md`.

## Options

```ts
type Severity = "off" | "warn" | "error";

shadcn({
  host?: "next";           // default: none
  files?: string[];        // default: ["**/*.{jsx,tsx}"]
  components?: string[] | false; // default: ["**/components/ui/**"]
  severity?: Severity;     // default: each rule's default above
  rules?: Record<RuleName, false | Severity | object | [Severity, object]>;
  settings?: object;       // becomes settings.shadcn on the app block
  rawElements?: false | Severity | {
    severity?: Severity;   // default: the factory's severity, else "error"
    elements?: object;     // merged over the rule's element map
    allow?: string[];      // files that may use raw elements
    components?: string[]; // default: the factory's components
  };
});
```

- `host`: a host preset, the same name `layout({ host })` takes. `"next"` is the only host. See [Next.js root error boundary](#nextjs-root-error-boundary).
- `files`: the files the six rules check. Add `.ts` and `.js` only if class strings live there, such as in `cva()` calls outside components.
- `components`: folder globs for the component-folder override. The override covers a file only if it also matches `files`. Pass `false` to skip the override.
- `severity`: one severity for every rule. `"warn"` is the way to start in an app that already has findings.
- `rules`: one entry per rule, by name without the `shadcn/` prefix. `false` turns the rule off. A severity keeps the default options, so `"no-restyle": "warn"` gives `["warn", { allow: ["layout"] }]`. An object is merged over the default options and sets no severity of its own. It takes the global `severity` when you set one, and the rule's default severity when you do not. So `severity: "warn"` with `"no-restyle": { allow: ["spacing"] }` gives `["warn", { allow: ["spacing"] }]`. A `[severity, options]` pair, exactly two items with a plain options object, replaces the entry as written. A `rules` entry wins over `severity`, except an options-only object, which inherits it.
- `settings`: the plugin's shared settings, such as `ui`, `componentImports` or `note`. See the plugin's [README, Settings](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/README.md#settings).
- `rawElements`: the `design-no-raw-element` entry. `false` turns it off. A severity sets only the level. An object sets `elements`, `allow` and `components` as the rule's options in `design-no-raw-element.md`, and `severity`. With `components: false`, the rule falls back to its own default folder, `**/components/ui/**`, unless `rawElements.components` names one.

The factory throws a `TypeError` for an unknown host, an unknown rule name, a bad severity, a `rules` value that is not a plain object, a rule entry of any other shape (the message names the rule), a non-array `files` or `components`, or a `rawElements` value of any other shape or with an unknown key.

## Next.js root error boundary

Next renders `app/global-error.tsx` in place of the root layout when the root layout itself fails. The file brings its own `<html>` and `<body>`, and the root layout's stylesheet and providers may not be there. A `Button` from the component folder could render unstyled or not at all. So the file needs raw elements and inline styles.

`shadcn({ host: "next" })` adds one block for `**/app/global-error.{jsx,tsx}` that turns off exactly two rules there:

| Rule | Why it is off in that file |
| --- | --- |
| `house-rules/design-no-raw-element` | The component folder may not render outside the root layout, so the file uses a raw `<button>`. |
| `shadcn/no-inline-styles` | The app's stylesheet may be missing, so the file styles itself with `style={{ ... }}`. |

Every other rule stays on in that file, so a palette class or a raw colour literal still fails. Every other file keeps both rules: `app/error.tsx` renders inside the root layout, and a `global-error.tsx` anywhere but directly in an `app/` folder, such as `app/settings/global-error.tsx`, is no Next file at all. The list lives in House Rules (`src/hosts.cjs`), so a Next app needs no `rawElements.allow` glob for it. `tests/fixtures/next-shell-app/` holds the root boundary and both siblings, and `tests/shadcn-host.test.mjs` checks that only the root boundary is freed.

```js
...shadcn({ host: "next", components: ["apps/web/src/components/ui/**"] }),
```

## Apps with findings already

Five rules default to `error`. In an app that already breaks them, the first `pnpm check` after you add the preset fails. A trial run on board-app at v0.19.0 on 2026-10-07, with five rules at `warn` and `require-static-classes` at `error`, found 71 findings and 0 errors. `require-static-classes` had 0 findings. 46 were `no-unknown-classes`, and 29 of those came from stylesheets outside the theme's import chain.

Start at warn, then promote each rule when its count reaches zero:

```js
...shadcn({ severity: "warn" }),
// later, once no-raw-colors is clean:
...shadcn({ severity: "warn", rules: { "no-raw-colors": "error" } }),
```

A `warn` never fails ESLint on its own. To stop the count from growing, run ESLint with `--max-warnings <count>`, as [docs/adoption.md:30-44](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/docs/adoption.md#L30-L44) shows. For `no-unknown-classes` false positives, import the stylesheet from the theme, or list the classes in `rules: { "no-unknown-classes": { allow: [...] } }`.

## Stricter utility checks

The defaults follow the plugin's adoption guide. Three settings make the preset as strict as a hand-written utility test, such as one that greps every TSX string for palette colours and raw lengths. Each was checked on a fixture against such a test, board-app's `tests/design-utilities.test.mjs`, one probe per check.

| A utility test catches | The default preset | Close it with |
| --- | --- | --- |
| Arbitrary layout values: `w-[42rem]`, `max-h-[50vh]`, `top-[3px]`, `-mt-[2px]`, `translate-x-[50%]` | passes them: `allow: ["layout"]` | `rules: { "no-arbitrary-values": { allow: [] } }` |
| Classes in any string, such as `const tone = "bg-pink-500"` | reads class sites only | `scanAllStrings: true` on `no-raw-colors` and `no-arbitrary-values` |
| `bg-white`, `text-black/50` | passes them: `no-raw-colors` always allows `white` and `black` | `design({ rules: { "design-no-raw-color-literal": { classColors: ["white", "black"] } } })` |

```js
...design({
  tokenFiles: ["apps/web/src/app/globals.css"],
  rules: { "design-no-raw-color-literal": { classColors: ["white", "black"] } },
}),
...shadcn({
  rules: {
    "no-arbitrary-values": { allow: [], scanAllStrings: true },
    "no-raw-colors": { scanAllStrings: true },
  },
}),
```

`scanAllStrings` reads only strings that contain a `-`, which every utility with a value does. The preset is stricter than such a test in two places. `no-arbitrary-values` reports `p-[var(--space-2)]`; write `p-(--space-2)` instead, which passes. It also reports platform colours such as `bg-[Canvas]`; list them in `allow` where an app needs them.

One gap stays open on purpose. The component folder owns its look, and most of it comes straight from the shadcn CLI, so `no-arbitrary-values` is off there and `rounded-[6px]` inside `components/ui` passes. Raw colours stay checked there by `no-raw-colors` and `design-no-raw-color-literal`. Turning `no-arbitrary-values` back on in the folder reports stock shadcn code, such as `focus-visible:ring-[3px]` and `transition-[color,box-shadow]`.

## TypeScript 7

ESLint itself is fine on TypeScript 7. The `@typescript-eslint/parser` that this preset sets runs on the TypeScript 6.0.3 that the app's `packageExtensions` gives `@house-rules/rules`.

The plugin is different. It also parses component files on its own, to read their `cva` variants and size props. It tries `oxc-parser` first and falls back to `@typescript-eslint/parser` ([src/project/parser.ts:82-122](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/packages/lint/src/project/parser.ts#L82-L122)). In an app on TypeScript 7, the fallback cannot work. pnpm builds the plugin's optional `@typescript-eslint/parser` peer against the app's TypeScript 7, and typescript-eslint then throws "typescript-eslint does not support TS 7.0." `pnpm peers check` reports it as an unmet `typescript` peer.

So in a TypeScript 7 app, `oxc-parser` is the only parser the plugin can use. If its native binding is missing on a machine, nothing fails. The plugin reads variants as unknown and keeps linting. `no-restyle` then drops the "Use a size (default, sm)" hint from its message, and the plugin may print "variants and wrappers are unknown". In a probe from a trial run on board-app at v0.19.0 on 2026-10-07, with `oxc-parser` blocked, Button variants read as unknown and the plugin printed "variants and wrappers are unknown". Nothing failed.

To guard against it:

- Never install with optional dependencies turned off.
- Check that `node_modules/.pnpm` holds an `@oxc-parser+binding-<platform>` folder for each machine and CI image.
- Keep one test that lints a component with a padding class and asserts the message names the sizes. This package's own fixture test does that.

## Overlap with the design rules

The [design rules](design-no-raw-color.md) and `@shadcn/lint` read different files. The three CSS design rules walk CSS `Declaration` nodes on the `@eslint/css` language ([src/design.mjs:46-51](../src/design.mjs)). `@shadcn/lint` reads class strings and JSX attributes, and its six rules ([src/plugin.ts:12-19](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/packages/lint/src/plugin.ts#L12-L19)) include no rule that lints CSS declarations. Its README says `<style>` blocks "are plain CSS; use a CSS linter for them" ([README.md:542](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/README.md#L542)).

The verdicts below come from a mapping made for the board-app trial, against House Rules commit `1a001b3`. The design rule sources and docs have not changed since. Each verdict rests on a fixture run through both linters.

| Design rule | Replaced by shadcn | Evidence |
| --- | --- | --- |
| [`design-no-raw-color`](design-no-raw-color.md) | Not | The rule checks colours in CSS declaration values ([src/design-no-raw-color.mjs:90](../src/design-no-raw-color.mjs)). `no-raw-colors` checks palette classes such as `bg-pink-500` and colour attributes such as `fill` ([src/rules/no-raw-colors.ts:36-44](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/packages/lint/src/rules/no-raw-colors.ts#L36-L44)), never CSS declarations. Fixture: a CSS file with `color: red`, `--bundle-bg: blue` and `border: 1px solid #fff` gives three design findings. ESLint does not run the shadcn rules on it at all. |
| [`design-no-raw-color-literal`](design-no-raw-color-literal.md) | Partly | Overlap: `no-raw-colors` reports `fill="#fff"`, `no-arbitrary-values` reports `bg-[#fff]`, and `no-inline-styles` reports `style={{ color: "#fff" }}`. Gap: a colour string that is not a class or a style passes every shadcn rule. `scanAllStrings` does not close the gap, because it reads only strings that contain a `-` ([src/sites/collect.ts:1329-1335](https://github.com/shadcn-ui/lint/blob/a89d04792f340bcea26af2d539a9eec7285fcc77/packages/lint/src/sites/collect.ts#L1329-L1335)). Fixture: `tests/fixtures/shadcn-app/src/pages/brand.ts`. `"#ffffff"` and `"rgb(1, 2, 3)"` pass all six rules with `scanAllStrings: true`, and the design rule reports both. `tests/shadcn-preset.test.mjs` asserts this. |
| [`design-no-unknown-token`](design-no-unknown-token.md) | Not | The rule checks that each CSS `var(--name)` has a definition ([src/design-no-unknown-token.mjs:52-60](../src/design-no-unknown-token.mjs)). No shadcn rule checks that a custom property is defined. Fixture: `bg-(--missing)` passes every shadcn rule, the same as `bg-(--card)`. `bg-[var(--missing)]` is reported by `no-arbitrary-values` for its brackets, and so is the defined `bg-[var(--card)]`. |
| [`design-scale-value`](design-scale-value.md) | Not | The rule checks CSS values such as `font-size` against a scale ([src/design-scale-value.mjs:84-90](../src/design-scale-value.mjs)). `no-arbitrary-values` suggests scale values for bracketed classes, but does not lint CSS declarations. Fixture: CSS `font-size: 12px` is reported only by the design rule, and the class `text-[12px]` only by shadcn. |

### Proposed removals: none today

- `design-no-raw-color`: keep. `@shadcn/lint` reads theme CSS only to learn the theme and does not lint its declarations, so raw colours in stylesheets would go unchecked.
- `design-no-raw-color-literal`: keep. Colour constants in code, such as a theme colour for a `<meta>` tag or an email template, pass every shadcn rule. Removing only the overlapping cases would need its own regression tests.
- `design-no-unknown-token`: keep. No shadcn rule checks that a `var()` token exists.
- `design-scale-value`: keep. Its scales cover CSS declarations, which `@shadcn/lint` does not lint.

Run both presets side by side. They report different files, and in the one overlap, the shadcn message says what to use instead.

## Limitations

- The default `files` cover JSX and TSX only. Vue and Svelte need their own parser block; see the plugin's docs.
- `no-unknown-classes` knows only the classes in the theme stylesheet and the files it imports. A class from a CSS file a component imports directly reads as unknown.
- Without `tailwindcss` installed, `no-unknown-classes` uses the plugin's bundled grammar, which knows less than a real Tailwind build.
- The preset sets no contracts. Add them through `rules` once you know what each component should let callers change.
