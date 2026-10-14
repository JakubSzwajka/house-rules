import path from "node:path";
import test from "node:test";
import { ACME, ACME_TOKENS, cssRuleTester, rule } from "./design-helpers.mjs";

const RULE = rule("design-no-raw-color");
const tokens = { tokenFiles: [ACME_TOKENS] };
const component = path.join(ACME, "apps/web/src/styles/component.css");

function nearest(color, token) {
  return { message: `Raw colour "${color}". Use a design token; the nearest is var(${token}).` };
}

test("design-no-raw-color", () => {
  cssRuleTester().run("design-no-raw-color", RULE, {
    valid: [
      {
        code: "a { color: var(--ink); background: transparent; border-color: currentColor; }",
        options: [tokens],
        filename: component,
      },
      {
        code: "a { color: inherit; outline-color: initial; fill: unset; }",
        options: [tokens],
        filename: component,
      },
      {
        name: "custom-property definitions inside a token file are the palette",
        code: ":root { --paper: #ecf2f3; } [data-theme='dark'] { --paper: oklch(0.2 0.01 200); }",
        options: [tokens],
        filename: ACME_TOKENS,
      },
      {
        code: 'a { background: url("data:image/svg+xml,%23fff") url(#fff); content: "#fff red"; }',
        options: [tokens],
        filename: component,
      },
      {
        code: "a { animation-name: tan; font-family: Navy, serif; grid-area: red; transition-property: color; }",
        options: [tokens],
        filename: component,
      },
      {
        code: "a { color: rgb(var(--ink-rgb) / 0.5); background: color-mix(in oklab, var(--ink), var(--paper)); }",
        options: [tokens],
        filename: component,
      },
      {
        code: "a { color: #fff; }",
        options: [{ ...tokens, allowValues: ["#FFF"] }],
        filename: component,
      },
      {
        code: "a { color: #fff; }",
        options: [{ ...tokens, allowIn: ["tests/fixtures/*/apps/**/component.{css,scss}"] }],
        filename: component,
      },
      {
        code: "a { width: 12px; margin: -1px; grid-template-areas: 'red blue'; }",
        options: [tokens],
        filename: component,
      },
    ],
    invalid: [
      {
        name: "Acme grid.css: #e8f4f5 is closest to the paper token",
        code: ".drop[data-over] {\n  background: #e8f4f5;\n}",
        options: [tokens],
        filename: component,
        errors: [
          { ...nearest("#e8f4f5", "--paper"), line: 2, column: 15, endLine: 2, endColumn: 22 },
        ],
      },
      {
        name: "Acme grid.css: #c5cdcf is closest to --line",
        code: ".plate-bars i { background: #c5cdcf; }",
        options: [tokens],
        filename: component,
        errors: [nearest("#c5cdcf", "--line")],
      },
      {
        name: "custom-property values outside the token files are reported",
        code: ".bundle-content {\n  --bundle-bg: #fff8ed;\n  --bundle-shade: rgba(0, 0, 0, 0.2);\n  --bundle-accent: tomato;\n}",
        options: [{ ...tokens, suggestNearest: false }],
        filename: component,
        errors: [
          { message: 'Raw colour "#fff8ed". Use a design token.', line: 2, column: 16 },
          { message: 'Raw colour "rgba(0, 0, 0, 0.2)". Use a design token.', line: 3, column: 19 },
          { message: 'Raw colour "tomato". Use a design token.', line: 4, column: 20 },
        ],
      },
      {
        name: "a token file's ordinary declarations are still checked",
        code: ":root { --paper: #ecf2f3; }\n::selection { background: #bfe0e3; }",
        options: [tokens],
        filename: ACME_TOKENS,
        errors: [{ ...nearest("#bfe0e3", "--line-soft"), line: 2, column: 27 }],
      },
      {
        name: "a colour equal to a token names that token",
        code: "a { color: #2B3133; }",
        options: [tokens],
        filename: component,
        errors: [{ message: 'Raw colour "#2B3133" is the value of var(--ink). Use the token.' }],
      },
      {
        name: "every colour form",
        code: "a { box-shadow: 0 0 0 1px #abc, 0 1px hsl(190 20% 40% / 0.5); color: hwb(190 10% 20%); background: lab(50% 10 10) lch(50% 10 10) oklab(0.5 0 0) oklch(0.5 0.1 200) color(display-p3 1 0 0) red; }",
        options: [{ ...tokens, suggestNearest: false }],
        filename: component,
        errors: [
          "#abc",
          "hsl(190 20% 40% / 0.5)",
          "hwb(190 10% 20%)",
          "lab(50% 10 10)",
          "lch(50% 10 10)",
          "oklab(0.5 0 0)",
          "oklch(0.5 0.1 200)",
          "color(display-p3 1 0 0)",
          "red",
        ].map((color) => ({ message: `Raw colour "${color}". Use a design token.` })),
      },
      {
        name: "var() fallbacks are raw colours too",
        code: "a { color: var(--missing, #06707e); }",
        options: [tokens],
        filename: component,
        errors: [{ message: 'Raw colour "#06707e" is the value of var(--pop). Use the token.' }],
      },
      {
        name: "transparent is reportable once removed from allowValues",
        code: "a { background: transparent; }",
        options: [{ ...tokens, allowValues: [] }],
        filename: component,
        errors: [
          { message: 'Raw colour "transparent". Use a design token; the nearest is var(--ink).' },
        ],
      },
      {
        name: "no token files still reports, without a suggestion",
        code: "a { color: #fff; }",
        filename: component,
        errors: [{ message: 'Raw colour "#fff". Use a design token.' }],
      },
    ],
  });
});
