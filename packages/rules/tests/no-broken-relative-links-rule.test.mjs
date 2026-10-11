import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import markdown from "@eslint/markdown";
import { Linter, RuleTester } from "eslint";
import plugin from "../src/index.mjs";
import { linkRoot, normalizeRoots, resolveLink } from "../src/relative-links.mjs";
import {
  RULE_ID,
  brokenTargets,
  createGitRepository,
  lintMarkdown,
  removeDirectory,
} from "./markdown-helpers.mjs";

let root;

before(() => {
  root = createGitRepository({
    tracked: {
      "README.md": "# Readme\n",
      "docs/setup.md": "# Setup\n",
      "packages/sdk/README.md": "# SDK\n",
      "packages/sdk/docs/guide.md": "# Guide\n",
      "packages/sdk/docs/api/index.md": "# API\n",
    },
  });
});

after(() => removeDirectory(root));

test("RuleTester runs the rule on the Markdown language with exact locations", () => {
  const ruleTester = new RuleTester({
    plugins: { markdown },
    language: "markdown/gfm",
    languageOptions: { frontmatter: "yaml" },
  });
  const filename = path.join(root, "docs/page.md");

  ruleTester.run("no-broken-relative-links", plugin.rules["no-broken-relative-links"], {
    valid: [
      { code: "[setup](./setup.md) ![readme](../README.md)", filename },
      {
        code: "[sdk](/README.md)",
        filename: path.join(root, "packages/sdk/docs/guide.md"),
        options: [{ roots: ["packages/sdk"] }],
      },
    ],
    invalid: [
      {
        code: 'Intro\n\nSee [gone](./gone.md "title").\n\n[ref]: ../nope/\n',
        filename,
        errors: [
          {
            messageId: "broken",
            data: { target: "./gone.md" },
            line: 3,
            column: 5,
            endLine: 3,
            endColumn: 30,
          },
          {
            messageId: "broken",
            data: { target: "../nope/" },
            line: 5,
            column: 1,
            endLine: 5,
            endColumn: 16,
          },
        ],
      },
      {
        code: "![logo](../assets/logo.png)",
        filename,
        errors: [{ messageId: "broken", data: { target: "../assets/logo.png" } }],
      },
    ],
  });
});

test("the roots option accepts only an array of unique non-empty strings", () => {
  const linter = new Linter({ cwd: root });
  const verify = (options) =>
    linter.verify(
      "[x](./setup.md)",
      [
        {
          files: ["**/*.md"],
          plugins: { markdown, "house-rules": plugin },
          language: "markdown/gfm",
          rules: { [RULE_ID]: ["error", options] },
        },
      ],
      {
        filename: path.join(root, "docs/page.md"),
      },
    );

  assert.deepEqual(verify({ roots: [] }), []);
  for (const options of [
    { roots: "packages/sdk" },
    { roots: [""] },
    { roots: ["a", "a"] },
    { other: true },
  ]) {
    assert.throws(
      () => verify(options),
      /Key "house-rules\/no-broken-relative-links"/,
      JSON.stringify(options),
    );
  }
});

test("the longest matching root wins and root spellings are normalized", () => {
  const roots = ["./packages/sdk/", "packages/sdk/docs"];
  assert.deepEqual(normalizeRoots(roots), ["packages/sdk", "packages/sdk/docs"]);
  assert.equal(linkRoot("packages/sdk/docs/api/index.md", roots), "packages/sdk/docs");
  assert.equal(linkRoot("packages/sdk/README.md", roots), "packages/sdk");
  assert.equal(linkRoot("packages/sdk-other/README.md", roots), "");
  assert.equal(
    resolveLink("packages/sdk/docs/api/index.md", "/guide.md", roots),
    "packages/sdk/docs/guide.md",
  );
  assert.equal(resolveLink("packages/sdk/docs/api/index.md", "../../README.md", roots), null);
  assert.equal(resolveLink("docs/page.md", "../..hidden.md"), "..hidden.md");
});

test("links outside every configured root resolve against the repository root", () => {
  const options = { roots: ["packages/sdk"] };
  assert.deepEqual(
    brokenTargets(
      lintMarkdown(root, "docs/page.md", "[r](/README.md) [s](/packages/sdk/README.md)", options),
    ),
    [],
  );
  assert.deepEqual(
    brokenTargets(
      lintMarkdown(
        root,
        "packages/sdk/docs/api/index.md",
        "[g](/docs/guide.md) [out](/docs/setup.md)",
        options,
      ),
    ),
    ["1:/docs/setup.md"],
  );
});
