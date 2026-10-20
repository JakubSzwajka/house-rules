import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { relativeLinkPath } from "../src/relative-links.mjs";
import {
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
      ".gitignore": ".env\n",
      "docs/setup.md": "# Setup\n",
      "docs/setup_(legacy).md": "# Legacy\n",
      "docs/a_((b)).md": "# Nested\n",
      "docs/with space.md": "# Space\n",
      "docs/guides/intro.md": "# Intro\n",
      "blocks-sdk/README.md": "# SDK\n",
      "blocks-sdk/docs/guide.md": "# Guide\n",
    },
    untracked: { ".env": "SECRET=placeholder\n", "docs/new-guide.md": "# New guide\n" },
  });
});

after(() => removeDirectory(root));

const broken = (markdown, file = "docs/page.md", options) =>
  brokenTargets(lintMarkdown(root, file, markdown, options));

test("happy path: existing relative, root-relative and anchored links pass", () => {
  const markdown = [
    "[setup](./setup.md)",
    '[readme](../README.md "Title")',
    "[root](/README.md)",
    "[section](setup.md#install)",
    "[angle](<./setup.md>)",
    "![image](setup.md)",
  ].join("\n");
  assert.deepEqual(broken(markdown), []);
});

test("broken link is reported with its line number", () => {
  const markdown = "intro\n\nsee [gone](./missing.md#part) and [ok](./setup.md)\n";
  assert.deepEqual(broken(markdown), ["3:./missing.md#part"]);
});

test("a case mismatch is broken even on a case-insensitive disk", () => {
  assert.deepEqual(broken("[s](./SETUP.md) [r](../readme.md)"), ["1:./SETUP.md", "1:../readme.md"]);
});

test("balanced parentheses stay part of the destination", () => {
  assert.deepEqual(broken("[legacy](./setup_(legacy).md) and [gone](./gone_(v1).md)"), [
    "1:./gone_(v1).md",
  ]);
});

test("a target outside the repository is broken", () => {
  assert.deepEqual(broken("[out](../../outside.md)"), ["1:../../outside.md"]);
});

test("non-ignored untracked files pass, ignored files and directories fail", () => {
  assert.deepEqual(broken("[new](./new-guide.md) [env](../.env) [dir](../docs) [root](/)"), [
    "1:../.env",
    "1:../docs",
    "1:/",
  ]);
});

test("backslash-escaped parentheses resolve without the backslashes", () => {
  assert.deepEqual(broken("[e](./setup_\\(legacy\\).md) [gone](./gone_\\(v1\\).md)"), [
    "1:./gone_(v1).md",
  ]);
});

test("parentheses nested more than one level stay part of the destination", () => {
  assert.deepEqual(broken("[ok](./a_((b)).md) [gone](./gone_((b)).md)"), ["1:./gone_((b)).md"]);
});

test("a destination on the line after the opening parenthesis is checked", () => {
  assert.deepEqual(broken('see [label](\n  ./missing.md "title"\n) here'), ["1:./missing.md"]);
});

test("text that only looks like a link is not checked", () => {
  const markdown = [
    "[words](not a link)",
    "[blank](",
    "",
    "./missing.md)",
    "[open](./missing.md",
  ].join("\n");
  assert.deepEqual(broken(markdown), []);
});

test("a parenthesized title does not hide the destination", () => {
  assert.deepEqual(broken("[doc](./missing.md (title)) [ok](./setup.md (title))"), [
    "1:./missing.md",
  ]);
});

test("a reference definition may put its destination on the next line", () => {
  const markdown = ["[gone]:", '  ./missing.md "title"', "[ok]:", "  <./setup.md>"].join("\n");
  assert.deepEqual(broken(markdown), ["1:./missing.md"]);
});

test("an escaped or unmatched bracket is literal text, not a link", () => {
  assert.deepEqual(broken("\\[label](./missing.md) and text](./missing.md)"), []);
});

test("a reference definition needs a valid title and cannot interrupt a paragraph", () => {
  assert.deepEqual(broken("[note]: this is prose"), []);
  assert.deepEqual(broken("Some text\n[a]: ./missing.md"), []);
  assert.deepEqual(broken('# Heading\n[a]: ./missing.md "title"'), ["2:./missing.md"]);
});

test("escaped backticks do not open a code span", () => {
  assert.deepEqual(broken("a \\` [x](./missing.md) \\` b"), ["1:./missing.md"]);
});

test("links inside HTML comments are skipped", () => {
  assert.deepEqual(broken("<!-- [x](./missing.md)\n[y](./missing-too.md) -->\n[z](./gone.md)"), [
    "3:./gone.md",
  ]);
});

test("indented code blocks are skipped, indented list content is not", () => {
  assert.deepEqual(broken("para\n\n    [x](./missing.md)\n"), []);
  assert.deepEqual(broken("- item\n\n    [x](./missing.md)\n"), ["3:./missing.md"]);
  assert.deepEqual(broken("para\n    [x](./missing.md)\n"), ["2:./missing.md"]);
});

test("a closing fence cannot carry an info string", () => {
  const markdown =
    "```md\nExample:\n```bash\n[in-code](./missing-a.md)\n```\n\n[real](./missing-b.md)\n";
  assert.deepEqual(broken(markdown), ["7:./missing-b.md"]);
});

test("fences inside lists and blockquotes are code", () => {
  assert.deepEqual(
    broken("- outer\n  - inner\n\n    ```md\n    [c](./missing-c.md)\n    ```\n"),
    [],
  );
  assert.deepEqual(broken("1.  step\n\n    ```\n    [d](./missing-d.md)\n    ```\n"), []);
  assert.deepEqual(broken("> ```md\n> [e](./missing-e.md)\n> ```\n\n[f](./missing-f.md)"), [
    "5:./missing-f.md",
  ]);
});

test("a quoted fence line inside a plain fence is just code", () => {
  const markdown =
    "```markdown\n> ```ts\n> [q](./missing-q.md)\n> ```\n```\n[after](./missing-r.md)";
  assert.deepEqual(broken(markdown), ["6:./missing-r.md"]);
});

test("an indented line right after a heading is code", () => {
  assert.deepEqual(broken("# Heading\n    [i](./missing-i.md)\n"), []);
});

test("a reference definition after a table row is a table cell, after a rule it is real", () => {
  assert.deepEqual(broken("| a | b |\n| - | - |\n| 1 | 2 |\n[ref]: ./missing.md\n"), []);
  assert.deepEqual(broken("---\n[ref]: ./missing.md\n\n[x][ref]\n"), ["2:./missing.md"]);
});

test("a whitespace-only or CRLF blank line ends the paragraph", () => {
  assert.deepEqual(broken("An [unclosed bracket\n  \nnew para](./missing-f.md)\n"), []);
  assert.deepEqual(broken("An [unclosed bracket\r\n\r\nnew para](./missing-f.md)\r\n"), []);
});

test("a code span may run across two lines of a paragraph", () => {
  assert.deepEqual(broken("Use `[x](./missing-g.md)\nstill code` here\n"), []);
});

test("a link cannot contain another link, but may contain an image", () => {
  assert.deepEqual(broken("[see [x](./setup.md)](./missing-h.md)"), []);
  assert.deepEqual(broken("[![badge](./setup.md)](./missing-j.md)"), ["1:./missing-j.md"]);
});

test("an indented fence line does not close a top-level fence", () => {
  const markdown =
    "```markdown\n1. Install:\n\n    ```bash\n    npm ci\n    ```\n```\n\nSee [the guide](./missing-guide.md).\n";
  assert.deepEqual(broken(markdown), ["9:./missing-guide.md"]);
});

test("a stray backtick does not pair across list items or table rows", () => {
  assert.deepEqual(broken("- Press the ` key\n- See [guide](./missing-g.md)\n- Run `ls`\n"), [
    "2:./missing-g.md",
  ]);
  assert.deepEqual(broken("| a | b |\n| - | - |\n| ` | [f](./missing-f.md) |\n| `x` | y |\n"), [
    "3:./missing-f.md",
  ]);
});

test("tab-indented and blockquoted indented code is skipped", () => {
  assert.deepEqual(broken("Example:\n\n\t[o](./missing-o.md)\n"), []);
  assert.deepEqual(broken("> Example:\n>\n>     [b](./missing-b.md)\n"), []);
  assert.deepEqual(broken("```\nx\n```\n    [a](./missing-a.md)\n"), []);
});

test("a reference definition inside a blockquote is checked", () => {
  assert.deepEqual(broken("> See [x][ref].\n>\n> [ref]: ./missing-c.md\n"), ["3:./missing-c.md"]);
});

test("links inside an HTML block are not Markdown links", () => {
  assert.deepEqual(broken("<div>\n[l](./missing-l.md)\n</div>\n"), []);
});

test("character references in a destination are decoded", () => {
  assert.deepEqual(broken("[q](./a&amp;b.md)"), ["1:./a&b.md"]);
});

test("links in YAML front matter are not checked, and line numbers still count it", () => {
  const markdown = '---\ntitle: "[x](./missing.md)"\n---\n# T\n[y](./gone.md)\n';
  assert.deepEqual(broken(markdown), ["5:./gone.md"]);
});

test("a link in a configured root must resolve inside it", () => {
  const inSdk = (markdown) =>
    broken(markdown, "blocks-sdk/docs/guide.md", { roots: ["blocks-sdk"] });
  assert.deepEqual(inSdk("[r](/README.md) [up](../README.md)"), []);
  assert.deepEqual(inSdk("[c](../../docs/setup.md)"), ["1:../../docs/setup.md"]);
});

test("reference definitions are checked, footnotes are not", () => {
  const markdown = "[ref]: ./missing.md\n[^1]: A footnote, not a link.\n";
  assert.deepEqual(broken(markdown), ["1:./missing.md"]);
});

test("directory targets fail, with or without a trailing slash", () => {
  assert.deepEqual(broken("[guides](./guides/) and [guides](guides)"), ["1:./guides/", "1:guides"]);
  assert.deepEqual(broken("[nope](./nope/)"), ["1:./nope/"]);
});

test("URLs with a scheme and pure anchors are skipped", () => {
  for (const target of [
    "https://example.com/x.md",
    "mailto:a@b.c",
    "vscode:open",
    "#top",
    "//cdn/x",
    "",
  ]) {
    assert.equal(relativeLinkPath(target), null, target);
  }
  assert.deepEqual(broken("[web](https://example.com/missing.md) [top](#top) [empty]()"), []);
});

test("template placeholders are skipped", () => {
  assert.equal(relativeLinkPath("{pr_url}"), null);
  assert.deepEqual(broken("[PR]({pr_url}) [file](./{name}.md)"), []);
});

test("fenced code blocks and inline code spans are skipped", () => {
  const markdown = [
    "```md",
    "[inside](./missing-a.md)",
    "```",
    "~~~",
    "[tilde](./missing-b.md)",
    "~~~",
    "inline `[span](./missing-c.md)` text",
    "[after](./missing-d.md)",
  ].join("\n");
  assert.deepEqual(broken(markdown), ["8:./missing-d.md"]);
});

test("URL-encoded paths are decoded before the lookup", () => {
  assert.equal(relativeLinkPath("with%20space.md#x"), "with space.md");
  assert.equal(relativeLinkPath("./setup.md?plain=1"), "./setup.md");
  assert.deepEqual(broken("[s](./with%20space.md) [q](./setup.md?plain=1)"), []);
});

test("every inline link on a line is reported", () => {
  assert.deepEqual(broken("[a](one.md) [b](two.md)"), ["1:one.md", "1:two.md"]);
});
