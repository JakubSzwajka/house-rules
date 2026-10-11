import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { repositoryPathsFor } from "../src/repository-paths.mjs";
import {
  brokenTargets,
  createDirectory,
  createGitRepository,
  lintMarkdown,
  removeDirectory,
  writeFiles,
} from "./markdown-helpers.mjs";

function withRepository(tracked, run) {
  const repository = createGitRepository({ tracked });
  try {
    run(repository, (...args) => execFileSync("git", args, { cwd: repository, stdio: "pipe" }));
  } finally {
    removeDirectory(repository);
  }
}

const MOVE_LINKS = "[o](./old.md) [n](./new.md)";

test("a file staged with git add mid-process stops being broken", () => {
  withRepository({ "README.md": "# Readme\n" }, (repository, git) => {
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[n](./new.md)")), [
      "1:./new.md",
    ]);
    writeFiles(repository, { "new.md": "# New\n" });
    git("add", "new.md");
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[n](./new.md)")), []);
  });
});

test("a file renamed with git mv mid-process moves the broken link to the old name", () => {
  withRepository({ "README.md": "# Readme\n", "old.md": "# Old\n" }, (repository, git) => {
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", MOVE_LINKS)), [
      "1:./new.md",
    ]);
    git("mv", "old.md", "new.md");
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", MOVE_LINKS)), [
      "1:./old.md",
    ]);
  });
});

test("a file removed with git rm mid-process becomes broken", () => {
  withRepository({ "README.md": "# Readme\n", "gone.md": "# Gone\n" }, (repository, git) => {
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[g](./gone.md)")), []);
    git("rm", "--quiet", "-f", "gone.md");
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[g](./gone.md)")), [
      "1:./gone.md",
    ]);
  });
});

test("a repository with no index yet has an empty tracked set until the first git add", () => {
  withRepository({}, (repository, git) => {
    writeFiles(repository, { "README.md": "# Readme\n" });
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "page.md", "[r](./README.md)")), [
      "1:./README.md",
    ]);
    git("add", "README.md");
    assert.deepEqual(brokenTargets(lintMarkdown(repository, "page.md", "[r](./README.md)")), []);
  });
});

test("git ls-files runs once per repository root while the index is unchanged", {
  skip: process.platform === "win32",
}, () => {
  const shim = createDirectory("house-rules-git-shim-");
  const log = path.join(shim, "calls.log");
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFiles(shim, { git: `#!/bin/sh\necho "$*" >> "${log}"\nexec "${realGit}" "$@"\n` });
  chmodSync(path.join(shim, "git"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${shim}${path.delimiter}${originalPath}`;
  const lsFilesCalls = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line.startsWith("ls-files")).length
      : 0;
  try {
    withRepository(
      { "README.md": "# Readme\n", "docs/setup.md": "# Setup\n" },
      (repository, git) => {
        for (const file of ["README.md", "docs/setup.md", "docs/page.md", "README.md"]) {
          assert.deepEqual(
            brokenTargets(lintMarkdown(repository, file, "[r](/README.md) [s](/docs/setup.md)")),
            [],
          );
        }
        assert.equal(lsFilesCalls(), 1);
        writeFiles(repository, { "new.md": "# New\n" });
        git("add", "new.md");
        assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[n](./new.md)")), []);
        assert.deepEqual(brokenTargets(lintMarkdown(repository, "README.md", "[n](./new.md)")), []);
        assert.equal(lsFilesCalls(), 2);
      },
    );
  } finally {
    process.env.PATH = originalPath;
    removeDirectory(shim);
  }
});

// Git hooks export an absolute GIT_DIR; in a linked worktree it points at `.git/worktrees/<name>`.
test("a linked worktree linted with GIT_DIR set, as in a git hook, resolves links from the worktree root", () => {
  const main = createGitRepository({
    tracked: { "README.md": "# Readme\n", "docs/guide.md": "# Guide\n" },
  });
  const worktree = path.join(createDirectory("codebase-ai-rules-worktree-"), "wt");
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    const git = (cwd, ...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
    git(
      main,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "init",
    );
    git(main, "worktree", "add", "--quiet", "-b", "wt", worktree);
    const gitDir = git(worktree, "rev-parse", "--absolute-git-dir").trim();
    assert.match(gitDir, /[/\\]worktrees[/\\]wt$/);
    // draft.md exists but is untracked: only a git-backed check reports it.
    writeFiles(worktree, {
      "docs/page.md": "",
      "docs/api/page.md": "",
      "docs/draft.md": "# Draft\n",
    });

    // Each case lints a different folder so the per-directory top-level cache cannot hide a failure.
    const cases = [
      [
        { GIT_DIR: gitDir },
        "docs/page.md",
        "[r](../README.md) [g](./guide.md) [d](./draft.md) [m](./missing.md)",
        ["1:./draft.md", "1:./missing.md"],
      ],
      [
        { GIT_DIR: gitDir, GIT_WORK_TREE: worktree },
        "docs/api/page.md",
        "[r](../../README.md) [g](../guide.md) [d](../draft.md) [m](./missing.md)",
        ["1:../draft.md", "1:./missing.md"],
      ],
    ];
    for (const [env, file, markdownText, broken] of cases) {
      delete process.env.GIT_WORK_TREE;
      Object.assign(process.env, env);
      assert.deepEqual(
        brokenTargets(lintMarkdown(worktree, file, markdownText)),
        broken,
        JSON.stringify(env),
      );
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeDirectory(path.dirname(worktree));
    removeDirectory(main);
  }
});

test("outside a git repository the rule checks the file system under cwd with exact case", () => {
  const plain = createDirectory("house-rules-plain-");
  try {
    assert.throws(() =>
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: plain, stdio: "pipe" }),
    );
    writeFiles(plain, { "README.md": "# Readme\n", "docs/setup.md": "# Setup\n" });
    const markdownText =
      "[a](./setup.md) [b](../README.md) [c](/docs) [d](./Setup.md) [e](./missing.md) [f](../../out.md)";
    assert.deepEqual(brokenTargets(lintMarkdown(plain, "docs/page.md", markdownText)), [
      "1:./Setup.md",
      "1:./missing.md",
      "1:../../out.md",
    ]);
    assert.equal(repositoryPathsFor(path.join(plain, "page.md"), path.join(plain, "docs")), null);
  } finally {
    removeDirectory(plain);
  }
});
