import assert from "node:assert/strict";
import test from "node:test";
import { ACME_SCALES, cssRuleTester, rule } from "./design-helpers.mjs";

const RULE = rule("design-scale-value");
const RADII = "2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 999px";

test("design-scale-value", () => {
  cssRuleTester().run("design-scale-value", RULE, {
    valid: [
      { code: "a { border-radius: 6px; border-top-left-radius: 999px; }", options: [ACME_SCALES] },
      { code: "a { border-radius: var(--radius) 4px / 2px; }", options: [ACME_SCALES] },
      { code: "a { border-radius: calc(var(--radius) - 2px); }", options: [ACME_SCALES] },
      { code: "a { box-shadow: none; text-shadow: NONE; }", options: [ACME_SCALES] },
      {
        code: "a { transition: border-color var(--t) ease, color var(--t) ease; animation-duration: var(--t-slow); }",
        options: [ACME_SCALES],
      },
      {
        code: "a { border-radius: inherit; transition: unset; box-shadow: revert-layer; }",
        options: [ACME_SCALES],
      },
      {
        code: "a { transition: none; }",
        options: [[{ property: "^transition$", allowed: ["none"], requireVar: "--t" }]],
      },
      {
        name: "custom properties are token definitions, not uses",
        code: "a { --radius: 7px; }",
        options: [ACME_SCALES],
      },
      { name: "no scales configured", code: "a { border-radius: 7px; }" },
      {
        name: "only the first matching entry applies",
        code: "a { border-radius: 7px; }",
        options: [
          [
            { property: "radius", allowed: ["7px"] },
            { property: "radius", allowed: ["1px"] },
          ],
        ],
      },
    ],
    invalid: [
      {
        name: "Acme grid.css: a flat-bottomed bar uses 0",
        code: ".plate-bars i {\n  border-radius: 2px 2px 0 0;\n}",
        options: [ACME_SCALES],
        errors: [
          {
            message: `border-radius "2px 2px 0 0" has values off the scale: 0. Allowed: ${RADII}.`,
            line: 2,
            column: 18,
            endLine: 2,
            endColumn: 29,
          },
        ],
      },
      {
        name: "a shadow when the system is flat",
        code: "a { box-shadow: 0 1px 2px var(--ink); }",
        options: [ACME_SCALES],
        errors: [
          {
            message:
              'box-shadow "0 1px 2px var(--ink)" has values off the scale: 0, 1px, 2px. Allowed: none.',
          },
        ],
      },
      {
        name: "Acme landing: a transition with its own durations",
        code: ".bundle-content {\n  transition:\n    opacity 420ms cubic-bezier(0.16, 1, 0.3, 1),\n    visibility 420ms linear;\n}",
        options: [ACME_SCALES],
        errors: [
          {
            message:
              'transition "opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), visibility 420ms linear": every layer must use var(--t…).',
            line: 3,
            column: 5,
          },
        ],
      },
      {
        name: "every layer needs the token, and none needs allowing",
        code: "a { transition: color var(--t), opacity 200ms; }\nb { transition: none; }",
        options: [ACME_SCALES],
        errors: [
          {
            message: 'transition "color var(--t), opacity 200ms": every layer must use var(--t…).',
            line: 1,
          },
          { message: 'transition "none": every layer must use var(--t…).', line: 2 },
        ],
      },
      {
        name: "a var with another prefix does not satisfy requireVar",
        code: "a { animation: spin var(--duration) linear; }",
        options: [[{ property: "^animation$", allowed: ["none"], requireVar: "--t" }]],
        errors: [
          {
            message:
              'animation "spin var(--duration) linear": every layer must use var(--t…) or be one of: none.',
          },
        ],
      },
    ],
  });
});

test("design-scale-value rejects an entry with neither allowed nor requireVar", () => {
  assert.throws(
    () =>
      cssRuleTester().run("design-scale-value", RULE, {
        valid: [{ code: "a {}", options: [[{ property: "radius" }]] }],
        invalid: [],
      }),
    /should match some schema in anyOf/,
  );
});
