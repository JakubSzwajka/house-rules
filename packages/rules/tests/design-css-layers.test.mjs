import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  cssRuleTester,
  lintWith,
  removeDirectory,
  rule,
  temporaryDirectory,
} from "./design-helpers.mjs";
import design from "../src/design.mjs";

const RULE = rule("design-css-layers");
const LAYERS = {
  layers: ["components", "overrides"],
  layerFiles: { overrides: ["src/touch.css"] },
};
const ALLOWED = "@layer components, @layer overrides";
const at = (file) => path.join(process.cwd(), file);

const unlayered = (what) => ({
  message: `${what} is outside an allowed layer. Put it inside one of: ${ALLOWED}.`,
});

test("design-css-layers", () => {
  cssRuleTester().run("design-css-layers", RULE, {
    valid: [
      {
        name: "rules and conditional at-rules inside an allowed layer",
        code: "@layer components { .button {} @media (max-width: 760px) { .phone {} } .card { &:hover {} } }",
        options: [LAYERS],
        filename: at("src/buttons.css"),
      },
      {
        name: "the restricted layer in its own file",
        code: "@layer overrides { @media (max-width: 760px) { html {} } }",
        options: [LAYERS],
        filename: at("src/touch.css"),
      },
      {
        name: "a sublayer of an allowed layer, nested or dotted",
        code: "@layer components { @layer buttons { .a {} } } @layer components.cards { .b {} }",
        options: [LAYERS],
        filename: at("src/a.css"),
      },
      {
        name: "statements need no layer: imports, layer order, custom variants",
        code: '@import "./b.css"; @layer theme, base, components; @custom-variant dark (&:is(.dark *));',
        options: [LAYERS],
        filename: at("src/a.css"),
        languageOptions: { tolerant: true },
      },
      {
        name: "at-rules named in unlayered may sit outside a layer, with their contents",
        code: "@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } } @font-face { font-family: X; }",
        options: [{ ...LAYERS, unlayered: ["keyframes", "font-face"] }],
        filename: at("src/a.css"),
      },
      {
        name: "token files are exempt by default",
        code: ":root { --ink: #111; } @theme inline { --color-ink: var(--ink); }",
        options: [{ ...LAYERS, tokenFiles: ["src/tokens.css"] }],
        filename: at("src/tokens.css"),
      },
    ],
    invalid: [
      {
        name: "an unlayered rule and an unlayered @media, each reported once",
        code: ".button { color: inherit; .icon {} }\n@media (x) { .phone {} }",
        options: [LAYERS],
        filename: at("src/buttons.css"),
        errors: [unlayered("This style rule"), unlayered("@media")],
      },
      {
        name: "a layer that is not on the list",
        code: "@layer base { .button { color: inherit; } }",
        options: [LAYERS],
        filename: at("src/buttons.css"),
        errors: [{ message: `@layer base is not an allowed layer. Use one of: ${ALLOWED}.` }],
      },
      {
        name: "a nested layer whose full name is not on the list",
        code: "@layer base { @layer components { .a {} } }\n@layer { .b {} }",
        options: [LAYERS],
        filename: at("src/a.css"),
        errors: [
          { message: `@layer base is not an allowed layer. Use one of: ${ALLOWED}.`, line: 1 },
          {
            message: `An anonymous @layer is not an allowed layer. Use one of: ${ALLOWED}.`,
            line: 2,
          },
        ],
      },
      {
        name: "the restricted layer in another file",
        code: "@layer overrides { .button { color: inherit; } }",
        options: [LAYERS],
        filename: at("src/buttons.css"),
        errors: [{ message: "@layer overrides is only allowed in src/touch.css." }],
      },
      {
        name: "!important, inside a layer or not, custom properties included",
        code: "@layer components { .button { color: red !important; --x: 1 !important; } }",
        options: [LAYERS],
        filename: at("src/buttons.css"),
        errors: [
          {
            message: "!important is not allowed. Order the cascade with @layer instead.",
            column: 31,
          },
          {
            message: "!important is not allowed. Order the cascade with @layer instead.",
            column: 54,
          },
        ],
      },
      {
        name: "@keyframes outside a layer unless unlayered names it",
        code: "@keyframes spin { from { rotate: 0deg; } }",
        options: [LAYERS],
        filename: at("src/a.css"),
        errors: [unlayered("@keyframes")],
      },
      {
        name: "checkTokenFiles puts token files under the same rules",
        code: ":root { --ink: #111 !important; }",
        options: [{ ...LAYERS, tokenFiles: ["src/tokens.css"], checkTokenFiles: true }],
        filename: at("src/tokens.css"),
        errors: [
          unlayered("This style rule"),
          { message: "!important is not allowed. Order the cascade with @layer instead." },
        ],
      },
    ],
  });
});

test("design-css-layers: design() keeps it off until the app passes layers, and passes the token files", async () => {
  const [off] = design({ tokenFiles: ["src/tokens.css"] });
  assert.equal(off.rules["house-rules/design-css-layers"], "off");
  const [on] = design({
    tokenFiles: ["src/tokens.css"],
    rules: { "design-css-layers": { layers: ["components"] } },
  });
  assert.deepEqual(on.rules["house-rules/design-css-layers"], [
    "error",
    { tokenFiles: ["src/tokens.css"], layers: ["components"] },
  ]);

  const root = temporaryDirectory({
    "src/tokens.css": ":root { --ink: #111111; }\n",
    "src/buttons.css":
      "@layer components { .a { color: var(--ink); } }\n.b { color: var(--ink); }\n",
  });
  try {
    const findings = await lintWith(
      root,
      design({
        tokenFiles: ["src/tokens.css"],
        source: false,
        rules: { "design-css-layers": { layers: ["components"], layerFiles: {} } },
      }),
      ["src"],
    );
    assert.deepEqual(
      findings.map(({ file, line, rule: id }) => `${file}:${line} ${id}`),
      ["src/buttons.css:2 design-css-layers"],
    );
  } finally {
    removeDirectory(root);
  }
});

test("design-css-layers rejects layerFiles for a layer that is not listed", async () => {
  const root = temporaryDirectory({ "a.css": ".a {}\n" });
  try {
    const config = design({
      source: false,
      rules: {
        "design-css-layers": { layers: ["components"], layerFiles: { overrides: ["a.css"] } },
      },
    });
    await assert.rejects(lintWith(root, config, ["a.css"]), /layerFiles names "overrides"/);
  } finally {
    removeDirectory(root);
  }
});

// Overlapping layers: a restriction on the parent or on the sublayer holds, whichever `layers` lists first.
test("design-css-layers enforces every layerFiles restriction on overlapping layers", async () => {
  const cases = [
    {
      name: "restricted sublayer listed after its allowed parent",
      layers: ["components", "components.private"],
      layerFiles: { "components.private": ["src/private.css"] },
      code: "@layer components.private { .x {} }",
      layer: "components.private",
      files: "src/private.css",
    },
    {
      name: "restricted sublayer listed before its allowed parent",
      layers: ["components.private", "components"],
      layerFiles: { "components.private": ["src/private.css"] },
      code: "@layer components.private { .x {} }",
      layer: "components.private",
      files: "src/private.css",
    },
    {
      name: "restricted parent listed after an unrestricted sublayer",
      layers: ["components.private", "components"],
      layerFiles: { components: ["src/private.css"] },
      code: "@layer components.private { .x {} }",
      layer: "components",
      files: "src/private.css",
    },
    {
      name: "restricted parent listed before an unrestricted sublayer",
      layers: ["components", "components.private"],
      layerFiles: { components: ["src/private.css"] },
      code: "@layer components.private { .x {} }",
      layer: "components",
      files: "src/private.css",
    },
    {
      name: "nested blocks reach the restricted sublayer",
      layers: ["components", "components.private"],
      layerFiles: { "components.private": ["src/private.css"] },
      code: "@layer components { @layer private { .x {} } }",
      layer: "components.private",
      files: "src/private.css",
    },
  ];
  for (const { name, layers, layerFiles, code, layer, files } of cases) {
    const options = { layers, layerFiles };
    const outside = await lintCode(code, options, "src/outside.css");
    assert.deepEqual(
      outside,
      [`@layer ${layer} is only allowed in ${files}.`],
      `${name}: outside the file`,
    );
    assert.deepEqual(await lintCode(code, options, files), [], `${name}: in the file`);
  }
});

test("design-css-layers reports each restriction a layer breaks", async () => {
  const options = {
    layers: ["components", "components.private"],
    layerFiles: { components: ["src/a.css"], "components.private": ["src/b.css"] },
  };
  const code = "@layer components.private { .x {} }";
  assert.deepEqual(await lintCode(code, options, "src/c.css"), [
    "@layer components is only allowed in src/a.css.",
    "@layer components.private is only allowed in src/b.css.",
  ]);
  assert.deepEqual(await lintCode(code, options, "src/a.css"), [
    "@layer components.private is only allowed in src/b.css.",
  ]);
  assert.deepEqual(await lintCode(code, options, "src/b.css"), [
    "@layer components is only allowed in src/a.css.",
  ]);
});

async function lintCode(code, options, file) {
  const root = temporaryDirectory({ [file]: `${code}\n` });
  try {
    const findings = await lintWith(
      root,
      design({ source: false, rules: { "design-css-layers": options } }),
      [file],
    );
    return findings.map(({ message }) => message);
  } finally {
    removeDirectory(root);
  }
}
