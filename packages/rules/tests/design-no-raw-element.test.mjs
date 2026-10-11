import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import tsParser from "@typescript-eslint/parser";
import plugin from "../src/index.mjs";
import { lintWith, removeDirectory, temporaryDirectory } from "./design-helpers.mjs";

const APP = path.resolve(import.meta.dirname, "fixtures/raw-element-app");

function config(options) {
  return [
    {
      files: ["**/*.{jsx,tsx}"],
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "house-rules": plugin },
      rules: { "house-rules/design-no-raw-element": options ? ["error", options] : "error" },
    },
  ];
}

const lines = (findings) =>
  findings.map(({ file, line, rule, message }) => `${file}:${line} ${rule} ${message}`);

const FORM = "src/pages/form.tsx";
const FORM_FINDINGS = [
  `${FORM}:6 design-no-raw-element Use <Button> from src/components/ui/button.tsx instead of a raw <button>.`,
  `${FORM}:7 design-no-raw-element Use <Input> from src/components/ui/input.tsx instead of a raw <input>.`,
  `${FORM}:10 design-no-raw-element Use <NativeSelect> from src/components/ui/native-select.tsx instead of a raw <select>.`,
];

test("design-no-raw-element reports elements the component folder replaces, and skips the folder itself", async () => {
  const findings = lines(await lintWith(APP, config(), ["src"]));
  assert.deepEqual(findings, [
    ...FORM_FINDINGS,
    "src/pages/global-error.tsx:3 design-no-raw-element Use <Button> from src/components/ui/button.tsx instead of a raw <button>.",
  ]);
});

test("design-no-raw-element: allow globs, extra pairs, removed defaults, and unless attributes", async () => {
  const findings = lines(
    await lintWith(
      APP,
      config({
        allow: ["src/pages/global-error.tsx"],
        elements: {
          a: { use: "Link", from: "next/link" },
          select: false,
          table: { use: "DataTable" },
          button: { component: "button", unless: { type: ["submit"] } },
        },
      }),
      ["src"],
    ),
  );
  assert.deepEqual(findings, [
    FORM_FINDINGS[1],
    `${FORM}:12 design-no-raw-element Use <DataTable> instead of a raw <table>.`,
    `${FORM}:14 design-no-raw-element Use <Link> from next/link instead of a raw <a>.`,
  ]);
});

test("design-no-raw-element reads only the component folders it is given", async () => {
  const none = await lintWith(APP, config({ components: ["src/widgets/**"] }), ["src/pages"]);
  assert.deepEqual(none, []);
  const root = temporaryDirectory({
    "app/_components/ui/textarea.tsx": "export const Textarea = () => <textarea />;\n",
    "app/_components/ui/tests/button.test.tsx": "export const t = 1;\n",
    "app/page.tsx": "export const Page = () => <><textarea /><button /></>;\n",
  });
  try {
    const options = { components: ["app/_components/ui/**"] };
    assert.deepEqual(lines(await lintWith(root, config(options), ["app"])), [
      "app/page.tsx:1 design-no-raw-element Use <Textarea> from app/_components/ui/textarea.tsx instead of a raw <textarea>.",
    ]);
    writeFileSync(path.join(root, "app/_components/ui/button.tsx"), "export const B = 1;\n");
    assert.equal((await lintWith(root, config(options), ["app/page.tsx"])).length, 2);
  } finally {
    removeDirectory(root);
  }
});

test("design-no-raw-element rejects a bad element map", async () => {
  for (const elements of [
    { Button: "button" },
    { a: { use: "Link", component: "a" } },
    { a: {} },
  ]) {
    await assert.rejects(
      lintWith(APP, config({ elements }), [FORM]),
      /design-no-raw-element/,
      JSON.stringify(elements),
    );
  }
});
