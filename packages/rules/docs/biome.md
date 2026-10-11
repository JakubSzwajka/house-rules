# Biome preset

Import path: `@house-rules/rules/biome`

It is drunk-cat-stack's `biome.json` without the `files` block, plus Tailwind parsing: formatter on (spaces, indent 2, line width 100), assist off, the CSS parser with `tailwindDirectives` on, and the linter with `preset: "none"` plus four rules.

| Rule | Level |
| --- | --- |
| `performance/noReExportAll` | error |
| `style/noNonNullAssertion` | error |
| `style/useFilenamingConvention` (`kebab-case` or `export`) | error |
| `style/noExcessiveLinesPerFile` (300 lines, blank lines counted) | warn |

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "extends": ["@house-rules/rules/biome"],
  "files": {
    "includes": ["**", "!!node_modules", "!!dist", "!!coverage", "!!generated", "!!.agent_sources"]
  }
}
```

Biome resolves the specifier through this package's `exports` map. The preset file is `biome/preset.json`, not `biome.json`, because Biome treats a nested file named `biome.json` as a second root config.

## Tailwind CSS

Since 0.12.0 the preset sets `css.parser.tailwindDirectives: true`, so Biome parses Tailwind v4 directives: `@theme`, `@apply`, `@custom-variant`, `@utility`, `@variant`, `@source`, `@plugin`, `@config`, `@reference`, and `@layer` blocks that hold them. Without it, each one fails with `Tailwind-specific syntax is disabled`, and a Tailwind app had to add the `css` key itself.

It is on in the preset, not in a separate opt-in preset, because it changes nothing for plain CSS. Plain CSS holds no Tailwind at-rule, and the flag only teaches the parser those. A test runs `biome check` over `tests/fixtures/presets/css/` with the preset and with the flag forced off: a formatted plain file and an unformatted one (with an unknown at-rule) give the same exit code and the same report both ways, and the Tailwind file passes only with the flag on. A repo that wants Tailwind syntax to fail can set `"css": { "parser": { "tailwindDirectives": false } }` in its own `biome.json`.

## Why `files` stays in the consumer

Biome does not merge `files.includes` from an extended config with the consumer's. When the consumer sets `files.includes`, the preset's list is dropped. A consumer that added one exclude would silently lose the rest. So the preset leaves `files` out, and each repository lists its own excludes. Globs in the consumer's list resolve against the consumer's root.

## Tested against

Biome 2.5.14. A test extends the preset from a symlinked install, checks a clean file passes, and checks that `export *`, a non-null assertion and a PascalCase file name each fail by rule name. Another runs the CSS fixtures above.
