import test from "node:test";
import { ACME_TOKENS, LANDING_TOKENS, cssRuleTester, rule } from "./design-helpers.mjs";

const RULE = rule("design-no-unknown-token");
const tokens = { tokenFiles: [ACME_TOKENS] };

function unknown(name) {
  return { message: `var(${name}) has no definition in the token files or in this file.` };
}

test("design-no-unknown-token", () => {
  cssRuleTester().run("design-no-unknown-token", RULE, {
    valid: [
      {
        code: "a { color: var(--ink); padding: var( --gap ) calc(var(--gap-lg) * 2); }",
        options: [tokens],
      },
      {
        name: "a token from any of several token files",
        code: "a { color: var(--pop); }",
        options: [{ tokenFiles: [LANDING_TOKENS, ACME_TOKENS] }],
      },
      {
        name: "same-file definitions resolve, even after the use",
        code: ".chart { background: var(--bundle-blue); }\n.bundle { --bundle-blue: var(--pop); }",
        options: [tokens],
      },
      {
        name: "@property registers a name",
        code: "@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }\na { rotate: var(--angle); }",
        options: [tokens],
      },
      {
        code: "a { height: var(--bar); width: var(--js-width); }",
        options: [{ ...tokens, allow: ["--bar", "/^--js-/"] }],
      },
    ],
    invalid: [
      {
        name: "Acme landing: --bar is set from JavaScript and defined nowhere",
        code: ".chart-bars i {\n  height: var(--bar);\n}",
        options: [tokens],
        errors: [{ ...unknown("--bar"), line: 2, column: 15, endLine: 2, endColumn: 20 }],
      },
      {
        name: "references inside raw custom-property values and fallbacks",
        code: "a { --shade: var(--line-softer); color: var(--missing, var(--also-missing, var(--ink))); }",
        options: [tokens],
        errors: [unknown("--line-softer"), unknown("--missing"), unknown("--also-missing")],
      },
      {
        name: "no token files means only same-file definitions count",
        code: "a { color: var(--ink); }",
        errors: [unknown("--ink")],
      },
      {
        name: "allow entries match whole names or regexes, not prefixes",
        code: "a { color: var(--js-x); height: var(--barrel); }",
        options: [{ ...tokens, allow: ["--bar", "/^--JS-/"] }],
        errors: [unknown("--js-x"), unknown("--barrel")],
      },
    ],
  });
});
