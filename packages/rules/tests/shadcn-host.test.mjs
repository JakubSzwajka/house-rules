import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import shadcn from "../src/shadcn.mjs";

test("shadcn({ host: 'next' }) adds one block that frees only global-error.tsx from two rules", () => {
  const plain = shadcn({ files: ["apps/web/**/*.tsx"] });
  const blocks = shadcn({ files: ["apps/web/**/*.tsx"], host: "next" });
  assert.deepEqual(blocks.slice(0, 2), plain);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[2].files, [["**/app/global-error.{jsx,tsx}", "apps/web/**/*.tsx"]]);
  assert.deepEqual(blocks[2].rules, {
    "shadcn/no-inline-styles": "off",
    "house-rules/design-no-raw-element": "off",
  });
  assert.deepEqual(shadcn({ host: undefined }), shadcn());
  for (const host of ["remix", "", null]) {
    assert.throws(() => shadcn({ host }), /shadcn\(\): unknown host .*\. Known hosts: next\./);
  }
});

// Next renders app/global-error.tsx in place of the root layout, without the app's components or
// stylesheet. A sibling such as app/error.tsx renders inside the layout and keeps both rules.
test("fixture app: with host next, only app/global-error.tsx may use a raw element and inline styles", async () => {
  const app = path.resolve(import.meta.dirname, "fixtures/next-shell-app");
  const findings = async (config) => {
    const eslint = new ESLint({ cwd: app, overrideConfigFile: true, overrideConfig: config });
    const results = await eslint.lintFiles(["src/app"]);
    return results
      .flatMap(({ filePath, messages }) =>
        messages
          .filter(({ ruleId }) =>
            ["house-rules/design-no-raw-element", "shadcn/no-inline-styles"].includes(ruleId),
          )
          .map(
            ({ ruleId }) => `${path.relative(app, filePath).split(path.sep).join("/")} ${ruleId}`,
          ),
      )
      .sort();
  };
  const everyFile = [
    "src/app/error.tsx house-rules/design-no-raw-element",
    "src/app/error.tsx shadcn/no-inline-styles",
    "src/app/global-error.tsx house-rules/design-no-raw-element",
    "src/app/global-error.tsx shadcn/no-inline-styles",
    "src/app/settings/global-error.tsx house-rules/design-no-raw-element",
    "src/app/settings/global-error.tsx shadcn/no-inline-styles",
  ];
  assert.deepEqual(await findings(shadcn()), everyFile);
  assert.deepEqual(
    await findings(shadcn({ host: "next" })),
    everyFile.filter((line) => !line.startsWith("src/app/global-error.tsx ")),
  );
});
