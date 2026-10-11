# Design: no raw colour literal rule

Rule ID: `house-rules/design-no-raw-color-literal`

The rule runs on JavaScript and TypeScript, JSX and TSX included. It reports a hex colour or a colour function written inside a string literal or template text. Use the `@house-rules/rules/design` factory to enable it.

```tsx
<div style={{ color: "var(--ink)" }} />          // passes
<div style={{ color: "#2b3133" }} />             // reported
<rect stroke="var(--pop, #06707e)" />            // passes: a var() fallback
const html = `<style>body { color: #1c1917; }</style>`;  // reported
<span>open bundle &#8599;</span>                 // passes: an HTML entity
```

The message is `Raw colour "#2b3133" in a string. Use a design token, such as var(--name) or a theme constant.`

## What the rule checks

It reads every string `Literal` and every template text part (`TemplateElement`). It reports:

- a hex colour with 3, 4, 6 or 8 digits
- a call to `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` or `color()` that contains a number

Named colours are not checked. In code, `"red"` is too often a word rather than a colour.

A match must start the string or follow whitespace, a quote, or one of `: ( , = ; { [ > |`. This keeps out:

- HTML entities, such as `&#8599;`
- URL fragments, such as `/page#cafe` or `https://example.com/#fade`
- template text right after `${…}`, such as `` `${base}#fff` ``

The rule also skips:

- the value of an `href`, `to`, `src`, `action` or `xlinkHref` attribute or object key, so `<a href="#fade">` passes
- a hex inside an absolute URL, such as `https://x.test/?q=#fff`
- a hex right after a query key, such as `/search?q=#fff` or `&q=#fff`
- a hex as the value of a CSS attribute selector, such as `[data-id="#add"]` or `[data-x=#bead]`
- a colour function that uses `var()`, such as `rgb(var(--ink-rgb) / 0.5)`
- a colour in a `var()` fallback, unless `skipVarFallback` is `false`

## Colour classes

With `classColors`, the rule also reads each string as Tailwind classes. It reports a colour utility whose colour is on the list, such as `bg-white` or `hover:text-black/50` with `classColors: ["white", "black"]`:

```tsx
const tone = "bg-white";                 // reported
<p className="md:!border-black/50" />    // reported
<p className="bg-background" />          // passes: a theme colour
<p className="whitespace-nowrap" />      // passes: not a colour utility
```

The message is `Class "bg-white" uses the raw colour white. Use a colour class built on a design token.`

It strips variants (`hover:`, `md:dark:`) and the `!` modifier, and accepts an opacity (`/50`, `/[0.4]`). The utilities are `bg`, `text`, `border` and its sides, `divide`, `ring`, `ring-offset`, `outline`, `fill`, `stroke`, `decoration`, `from`, `via`, `to`, `accent`, `caret`, `placeholder`, `shadow`, `inset-shadow`, `drop-shadow` and `text-shadow`.

It closes the one gap `@shadcn/lint` leaves on purpose: its `no-raw-colors` reports palette classes such as `bg-pink-500`, but always allows `white` and `black`. See [shadcn.md](shadcn.md#stricter-utility-checks). The list is off by default, so existing apps see no change.

## Options

```ts
type Options = [
  {
    skipVarFallback?: boolean; // default: true
    allowIn?: string[];        // default: []
    classColors?: string[];    // default: []
  },
];
```

- `skipVarFallback`: ignore colours in the fallback of `var(--x, …)`. The token is used; the fallback only matters when the token is missing.
- `allowIn`: file globs, relative to ESLint's working directory, where the rule does nothing. It supports `**`, `*`, `?`, `[...]` and `{a,b}`. As in minimatch, a wildcard does not match a name that starts with `.`, so `**/*.ts` skips `.env.ts` and `.github/x.ts`; write the dot, as in `.github/**`, to match one. Use it for a theme module that owns the raw values, or a standalone page that cannot load the token stylesheet.
- `classColors`: colour names a Tailwind colour utility may not use, lower case, such as `["white", "black"]`. See "Colour classes".

## Limitations

- A string such as `"issue #123"` is reported, because `#123` is a valid colour.
- A hex after `=` in other contexts is still reported, such as `"a=#fff"` or `<rect fill=#fff>`. Only a query key (`?q=` or `&q=`) and an attribute selector (`[name=`) are skipped.
- JSX text children are not checked.
- The rule has no autofix.
