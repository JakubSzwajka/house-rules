import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import markdown from "@eslint/markdown";
import { ESLint } from "eslint";
import plugin from "../src/index.mjs";
import markdownConfig, { markdown as namedMarkdownConfig } from "../src/markdown.mjs";
import { RULE_ID, createGitRepository, removeDirectory } from "./markdown-helpers.mjs";

test("the markdown preset enables only the relative-link rule on GFM with YAML front matter", () => {
  assert.equal(namedMarkdownConfig, markdownConfig);
  assert.equal(markdownConfig.length, 1);
  const [config] = markdownConfig;
  assert.deepEqual(config.files, ["**/*.md"]);
  assert.equal(config.language, "markdown/gfm");
  assert.deepEqual(config.languageOptions, { frontmatter: "yaml" });
  assert.equal(config.plugins.markdown, markdown);
  assert.equal(config.plugins["house-rules"], plugin);
  assert.deepEqual(config.rules, { [RULE_ID]: "error" });
});

test("the package entry point does not load @eslint/markdown", async () => {
  const sourceDirectory = path.resolve(import.meta.dirname, "../src");
  const seen = new Set();
  const pending = ["index.mjs"];
  const packages = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(path.join(sourceDirectory, file), "utf8");
    for (const [, specifier] of source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)) {
      if (specifier.startsWith("./")) pending.push(specifier.slice(2));
      else packages.add(specifier);
    }
  }
  assert.ok(seen.has("no-broken-relative-links.mjs"));
  assert.equal(packages.has("@eslint/markdown"), false, [...packages].join(", "));
  assert.deepEqual(Object.keys(plugin.configs), ["recommended", "capability"]);
});

test("ESLint reports exact findings for good, broken, and wrong-case links in a git repository", async () => {
  const root = createGitRepository({
    tracked: {
      "README.md": "# Project\n\nRead the [guide](docs/guide.md).\n",
      "docs/guide.md":
        "# Guide\n\nBack to the [readme](../README.md).\n\nSee [missing](./missing.md).\n",
      "docs/case.md":
        "---\ntitle: Case\n---\n\n# Case\n\nSee [guide](./Guide.md) and ![diagram](../assets/diagram.png).\n",
    },
  });
  try {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: markdownConfig,
    });
    const results = await eslint.lintFiles(["**/*.md"]);
    const findings = results
      .map(({ filePath, messages }) => ({
        file: path.relative(root, filePath).split(path.sep).join("/"),
        messages: messages.map(({ ruleId, message, line, column, endLine, endColumn }) => ({
          ruleId,
          message,
          line,
          column,
          endLine,
          endColumn,
        })),
      }))
      .sort((left, right) => (left.file < right.file ? -1 : 1));

    assert.deepEqual(findings, [
      { file: "README.md", messages: [] },
      {
        file: "docs/case.md",
        messages: [
          {
            ruleId: RULE_ID,
            message:
              'Broken relative link "./Guide.md": no tracked file or directory at that path.',
            line: 7,
            column: 5,
            endLine: 7,
            endColumn: 24,
          },
          {
            ruleId: RULE_ID,
            message:
              'Broken relative link "../assets/diagram.png": no tracked file or directory at that path.',
            line: 7,
            column: 29,
            endLine: 7,
            endColumn: 62,
          },
        ],
      },
      {
        file: "docs/guide.md",
        messages: [
          {
            ruleId: RULE_ID,
            message:
              'Broken relative link "./missing.md": no tracked file or directory at that path.',
            line: 5,
            column: 5,
            endLine: 5,
            endColumn: 28,
          },
        ],
      },
    ]);
  } finally {
    removeDirectory(root);
  }
});
