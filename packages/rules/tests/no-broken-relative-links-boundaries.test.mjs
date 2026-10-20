import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  brokenTargets,
  createDirectory,
  createGitRepository,
  lintMarkdown,
  removeDirectory,
  writeFiles,
} from "./markdown-helpers.mjs";

const broken = (root, text, file = "README.md", options) =>
  brokenTargets(lintMarkdown(root, file, text, options));

test("ignore rules reject indexed files too, and an indexed directory is not a file", () => {
  const root = createGitRepository({
    tracked: { "README.md": "# Readme\n", "private.md": "private\n", "replaced.md": "file\n" },
  });
  try {
    writeFiles(root, { ".gitignore": "private.md\n" });
    unlinkSync(path.join(root, "replaced.md"));
    mkdirSync(path.join(root, "replaced.md"));
    assert.deepEqual(broken(root, "[p](./private.md) [d](./replaced.md) [r](./README.md)"), [
      "1:./private.md",
      "1:./replaced.md",
    ]);
  } finally {
    removeDirectory(root);
  }
});

test("file symlinks need eligible paths at every hop and stay inside the repository", () => {
  const root = createGitRepository({
    tracked: { "README.md": "# Readme\n", "tracked.md": "tracked\n" },
    untracked: {
      "draft.md": "draft\n",
      "private.md": "private\n",
      ".gitignore": "private.md\nhidden-link.md\n",
    },
  });
  const outside = `${root}-outside`;
  mkdirSync(outside);
  try {
    writeFiles(outside, {
      "guide.md": "outside\n",
      "tracked.md": "outside\n",
      "nested/file.md": "nested\n",
    });
    const links = {
      "tracked-link.md": "tracked.md",
      "draft-link.md": "draft.md",
      "chain.md": "draft-link.md",
      "private-link.md": "private.md",
      "hidden-link.md": "tracked.md",
      "hidden-hop.md": "hidden-link.md",
      "escape.md": path.join(outside, "guide.md"),
      portal: path.join(outside, "nested"),
      "escape-dotdot.md": "portal/../tracked.md",
      "dangling.md": "missing.md",
      "directory.md": ".",
      "loop-a.md": "loop-b.md",
      "loop-b.md": "loop-a.md",
    };
    for (const [file, target] of Object.entries(links)) symlinkSync(target, path.join(root, file));
    assert.deepEqual(
      broken(root, "[t](./tracked-link.md) [d](./draft-link.md) [c](./chain.md)"),
      [],
    );
    for (const file of [
      "private-link.md",
      "hidden-link.md",
      "hidden-hop.md",
      "escape.md",
      "escape-dotdot.md",
      "dangling.md",
      "directory.md",
      "loop-a.md",
    ]) {
      assert.deepEqual(broken(root, `[x](./${file})`), [`1:./${file}`], file);
    }
    assert.deepEqual(broken(root, `[x](../${path.basename(outside)}/guide.md)`), [
      `1:../${path.basename(outside)}/guide.md`,
    ]);
  } finally {
    removeDirectory(root);
    removeDirectory(outside);
  }
});

test("a tracked symlink cannot bypass later ignore rules, deletion or an outside retarget", () => {
  const root = createGitRepository({
    tracked: { "README.md": "# Readme\n", "target.md": "target\n" },
  });
  const outside = createDirectory("house-rules-link-outside-");
  try {
    symlinkSync("target.md", path.join(root, "alias.md"));
    // The fixture's index, never the checkout index, records the symlink.
    execFileSync("git", ["add", "alias.md"], { cwd: root, stdio: "pipe" });
    assert.deepEqual(broken(root, "[a](./alias.md)"), []);
    writeFiles(root, { ".gitignore": "target.md\n" });
    assert.deepEqual(broken(root, "[a](./alias.md)"), ["1:./alias.md"]);
    writeFiles(root, { ".gitignore": "" });
    unlinkSync(path.join(root, "target.md"));
    assert.deepEqual(broken(root, "[a](./alias.md)"), ["1:./alias.md"]);
    writeFiles(outside, { "target.md": "outside\n" });
    unlinkSync(path.join(root, "alias.md"));
    symlinkSync(path.join(outside, "target.md"), path.join(root, "alias.md"));
    assert.deepEqual(broken(root, "[a](./alias.md)"), ["1:./alias.md"]);
  } finally {
    removeDirectory(root);
    removeDirectory(outside);
  }
});

test("directory aliases do not admit unlisted children or escape a configured root", () => {
  const root = createGitRepository({
    tracked: {
      "README.md": "# Readme\n",
      "sdk/guide.md": "guide\n",
      "private/guide.md": "private\n",
    },
  });
  try {
    symlinkSync("private", path.join(root, "alias"));
    symlinkSync("../README.md", path.join(root, "sdk/out.md"));
    symlinkSync("guide.md", path.join(root, "sdk/in.md"));
    writeFiles(root, { ".gitignore": "private/\n" });
    assert.deepEqual(broken(root, "[x](./alias/guide.md) [d](./alias)"), [
      "1:./alias/guide.md",
      "1:./alias",
    ]);
    assert.deepEqual(
      broken(root, "[x](./out.md) [i](./in.md)", "sdk/guide.md", { roots: ["sdk"] }),
      ["1:./out.md"],
    );
  } finally {
    removeDirectory(root);
  }
});

test("without Git installed the existing exact-case filesystem fallback remains", () => {
  const root = createDirectory("house-rules-link-no-git-");
  const oldPath = process.env.PATH;
  try {
    writeFiles(root, { "README.md": "# Readme\n", "docs/guide.md": "guide\n" });
    process.env.PATH = "";
    assert.deepEqual(
      broken(root, "[r](./README.md) [d](./docs) [c](./readme.md) [m](./missing.md)"),
      ["1:./readme.md", "1:./missing.md"],
    );
  } finally {
    process.env.PATH = oldPath;
    removeDirectory(root);
  }
});

test("a failed Git listing never falls back to admitting ignored files", {
  skip: process.platform === "win32",
}, () => {
  const root = createGitRepository({ tracked: { "README.md": "# Readme\n" } });
  const shim = createDirectory("house-rules-link-git-shim-");
  const oldPath = process.env.PATH;
  try {
    writeFiles(root, { ".gitignore": "private.md\n", "private.md": "private\n" });
    writeFiles(shim, {
      git: `#!/bin/sh\nif [ "$1" = "rev-parse" ]; then printf '%s\\n' '${root}'; else exit 1; fi\n`,
    });
    chmodSync(path.join(shim, "git"), 0o755);
    process.env.PATH = `${shim}${path.delimiter}${oldPath}`;
    assert.deepEqual(broken(root, "[p](./private.md) [r](./README.md)"), [
      "1:./private.md",
      "1:./README.md",
    ]);
  } finally {
    process.env.PATH = oldPath;
    removeDirectory(root);
    removeDirectory(shim);
  }
});
