import path from "node:path";
import test from "node:test";
import { rule, sourceRuleTester } from "./design-helpers.mjs";

const RULE = rule("design-no-raw-color-literal");

function rawClass(className, color) {
  return {
    message: `Class "${className}" uses the raw colour ${color}. Use a colour class built on a design token.`,
  };
}

function raw(color) {
  return {
    message: `Raw colour "${color}" in a string. Use a design token, such as var(--name) or a theme constant.`,
  };
}

test("design-no-raw-color-literal", () => {
  sourceRuleTester().run("design-no-raw-color-literal", RULE, {
    valid: [
      { code: 'const style = { color: "var(--ink)" };', filename: "style.ts" },
      {
        name: "HTML entities are not colours",
        code: "const Open = () => <span>open bundle &#8599;</span>;\nconst arrow = '&#8599; &#8592; &#x2197;';",
        filename: "open.tsx",
      },
      {
        name: "URL fragments are not colours",
        code: 'const url = "https://example.com/page#cafe"; const local = "/b/slug#fade"; const q = "?v=1#add";',
        filename: "links.ts",
      },
      {
        name: "href values are URLs",
        code: 'const A = () => <a href="#fade">top</a>; const link = { href: "#bead", to: "#cafe" };',
        filename: "anchor.tsx",
      },
      {
        name: "a var() fallback is skipped by default",
        code: 'const Mark = () => <rect stroke="var(--pop, #06707e)" />;',
        filename: "mark.tsx",
      },
      { code: 'const s = "rgb(var(--ink-rgb) / 0.5)";', filename: "channels.ts" },
      {
        code: 'const s = "Pick a color(s) and an rgb(a) value"; const id = "user#12345678x";',
        filename: "prose.ts",
      },
      { code: "const tag = `${prefix}#fff`;", filename: "template.ts" },
      {
        code: 'const t = "#fff";',
        options: [{ allowIn: ["**/theme/*.ts"] }],
        filename: path.join(process.cwd(), "src/theme/colors.ts"),
      },
      { code: "const n = 0xfff; const s = 'issue #12 and #12345';", filename: "numbers.ts" },
      {
        name: "CSS attribute selectors are not colours",
        code: "document.querySelector('[data-id=\"#add\"]'); const s = \"a[href^='#cafe']\";",
        filename: "select.ts",
      },
      {
        name: "URL query values are not colours",
        code: 'const u = "https://x.test/?q=#fff"; const v = `/search?a=1&q=#abc`;',
        filename: "query.ts",
      },
      {
        name: "ids, regex literals and JSX text are not strings to check",
        code: 'const id = "#main"; const re = /#fff/; const C = () => <p>color #fff</p>;',
        filename: "misc.tsx",
      },
      {
        name: "classColors is off by default, and names only the listed colours",
        code: 'const a = "bg-white text-black"; const b = <p className="bg-background text-whitesmoke" />;',
        filename: "classes.tsx",
      },
      {
        name: "classColors ignores look-alike utilities and theme colours",
        code: 'const a = <p className="bg-background text-white-ish w-white whitespace-nowrap" />;',
        options: [{ classColors: ["white", "black"] }],
        filename: "classes.tsx",
      },
    ],
    invalid: [
      {
        name: "classColors: colour utilities with variants, opacity and ! in any string",
        code: 'const tone = "bg-white";\nconst P = () => <p className="p-2 hover:text-black/50 !border-white md:dark:ring-offset-black" />;\nconst t = `fill-white/[0.4] ${x}`;',
        options: [{ classColors: ["white", "black"] }],
        filename: "classes.tsx",
        errors: [
          { ...rawClass("bg-white", "white"), line: 1, column: 15, endColumn: 23 },
          { ...rawClass("hover:text-black/50", "black"), line: 2, column: 35 },
          { ...rawClass("!border-white", "white"), line: 2 },
          { ...rawClass("md:dark:ring-offset-black", "black"), line: 2 },
          { ...rawClass("fill-white/[0.4]", "white"), line: 3 },
        ],
      },
      {
        name: "Hosti respond.ts: Tailwind stone colours in the 404 page template",
        code: "const html = `<style>\n  body { color: #1c1917; background: #fafaf9; }\n  code { background: #f5f5f4; }\n</style>`;",
        filename: "respond.ts",
        errors: [
          { ...raw("#1c1917"), line: 2, column: 17, endLine: 2, endColumn: 24 },
          { ...raw("#fafaf9"), line: 2, column: 38 },
          { ...raw("#f5f5f4"), line: 3, column: 22 },
        ],
      },
      {
        name: "string literals, JSX attributes and style objects",
        code: 'const a = "#fff";\nconst B = () => <div style={{ color: "rgba(0, 0, 0, 0.5)", borderColor: "hsl(0 0% 0%)" }} data-c="#ABCDEF80" />;',
        filename: "component.tsx",
        errors: [raw("#fff"), raw("rgba(0, 0, 0, 0.5)"), raw("hsl(0 0% 0%)"), raw("#ABCDEF80")],
      },
      {
        name: "template text after an expression and multi-line colour functions",
        code: "const css = `a { color: ${ink}; background: oklch(0.5 0.1\n  200); }`;",
        filename: "css.ts",
        errors: [{ ...raw("oklch(0.5 0.1 200)"), line: 1, column: 45, endLine: 2, endColumn: 7 }],
      },
      {
        name: "colours inside CSS declarations and shorthands",
        code: 'const a = "color: #1c1917"; const b = `background:#fafaf9;`; const c = "1px solid #e5e5e5"; const d = "rgb(0 0 0 / 50%)";',
        filename: "declarations.ts",
        errors: [raw("#1c1917"), raw("#fafaf9"), raw("#e5e5e5"), raw("rgb(0 0 0 / 50%)")],
      },
      {
        name: "skipVarFallback: false reports fallbacks",
        code: 'const s = "var(--pop, #06707e)";',
        options: [{ skipVarFallback: false }],
        filename: "mark.ts",
        errors: [{ ...raw("#06707e"), column: 23 }],
      },
      {
        name: "only the fallback of var() is skipped",
        code: 'const s = "var(--a, var(--b, #000)) #111";',
        filename: "nested.ts",
        errors: [raw("#111")],
      },
    ],
  });
});
