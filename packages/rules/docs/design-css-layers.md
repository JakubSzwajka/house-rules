# Design: CSS layers rule

Rule ID: `house-rules/design-css-layers`

The rule runs on the `@eslint/css` language. It requires every app style rule to sit inside an allowed `@layer`, keeps a restricted layer to the files you name, and reports `!important`. It is opt-in: the `@house-rules/rules/design` factory turns it on once you pass its `layers`.

```css
@layer components { .button { color: inherit; } }   /* passes */
.button { color: inherit; }                          /* reported: outside a layer */
@layer base { .button { color: inherit; } }          /* reported: base is not allowed */
@layer overrides { html { touch-action: none; } }    /* reported outside the one overrides file */
@layer components { .x { color: red !important; } }  /* reported: !important */
```

Cascade layers set which styles win by layer order, not by selector weight or source order. An unlayered rule beats every layered one, and `!important` turns the order upside down. Both quietly undo the design system's own styles. This rule keeps every app style in a known layer and the order in one place.

## What the rule checks

- A style rule outside an allowed layer is reported: `This style rule is outside an allowed layer. Put it inside one of: @layer components, @layer overrides.`
- A block at-rule outside an allowed layer is reported the same way, such as `@media`, `@supports`, `@keyframes` or Tailwind's `@utility`, unless `unlayered` names it. Everything inside a reported rule is left alone, so one mistake gives one report.
- A layer block whose name is not allowed is reported: `@layer base is not an allowed layer. Use one of: @layer components, @layer overrides.` A sublayer of an allowed layer is allowed, nested (`@layer components { @layer buttons {} }`) or dotted (`@layer components.buttons {}`). A nested layer takes its full dotted name, so `@layer base { @layer components {} }` is `base.components`. An anonymous `@layer {}` outside an allowed layer is reported.
- A layer restricted by `layerFiles` is reported in any other file: `@layer overrides is only allowed in src/styles/touch.css.`
- Every `!important` is reported, inside a layer or not, custom properties included: `!important is not allowed. Order the cascade with @layer instead.`

Statements without a block need no layer: `@import`, the layer order statement `@layer theme, base, components;`, `@charset`, and Tailwind's `@custom-variant`, `@source` and `@plugin`. An imported file is linted on its own.

## Token files

Token files are exempt by default, the whole file. A token file holds the theme: Tailwind's `@import "tailwindcss"`, `@theme`, `@custom-variant` and `@utility`, plus `:root` and `.dark` blocks. Tailwind wants `@theme` and `@utility` at the top level, so a token file cannot follow the app's layer list. It is also where the layer order statement lives. Set `checkTokenFiles: true` to put token files under the same rules.

`design()` passes its `tokenFiles` to this rule, as it does for the other token rules.

## Options

```ts
type Options = [
  {
    layers: string[];                      // required, at least one
    layerFiles?: Record<string, string[]>; // default: {}
    unlayered?: string[];                  // default: []
    tokenFiles?: string[];                 // default: []; design() fills it
    checkTokenFiles?: boolean;             // default: false
  },
];
```

- `layers`: the layer names app styles may use, such as `["components", "overrides"]`. A dotted name, such as `components.buttons`, allows only that sublayer.
- `layerFiles`: layer name → file globs, relative to ESLint's working directory. That layer, and its sublayers, may appear only in those files. Restrictions on overlapping layers all apply, such as `components` and `components.private`, whatever order `layers` lists them in; a layer that breaks several gets one finding for each. Each key must be in `layers`, or the lint stops with an error.
- `unlayered`: at-rule names, without `@`, that may sit outside a layer, such as `["keyframes", "font-face"]`. Their contents are not checked for placement.
- `tokenFiles`, `checkTokenFiles`: see "Token files".

```js
design({
  tokenFiles: ["apps/web/src/app/globals.css"],
  rules: {
    "design-css-layers": {
      layers: ["components", "overrides"],
      layerFiles: { overrides: ["apps/web/src/app/styles/touch.css"] },
    },
  },
});
```

## Overlap with @eslint/css

`@eslint/css` has `use-layers` and `no-important`. `use-layers` asks for some layer and checks names against one pattern. It cannot list the allowed layers, tie a layer to files, or skip token files. Use this rule instead of both.

## Limitations

- The rule reads one file at a time. It does not check that the layer order statement lists the allowed layers, or in which order.
- `!important` inside a token file is not reported unless `checkTokenFiles` is `true`.
