import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { invoke, withWorkspace } from "./comments-workspace.mjs";

test("CLI accepts lexical data and adjacent rationale before code in supported formats", () => {
  withWorkspace((cwd) => {
    writeFileSync(
      path.join(cwd, "app.py"),
      "#!/usr/bin/env python3\ntext = '# not a comment'\n'''\n# still string data\n'''\nvalue = 1\n# The remote endpoint can lag behind this process.\nnext_value = value\n",
    );
    writeFileSync(
      path.join(cwd, "config.yaml"),
      "script: |\n  # shell data, not YAML comment\nname: app # pinned by deployment\n",
    );
    writeFileSync(
      path.join(cwd, "Dockerfile"),
      "# syntax=docker/dockerfile:1\nFROM node:24\nRUN echo '# data'\n",
    );
    writeFileSync(path.join(cwd, "styles.css"), '.x { content: "/* data */"; }\n');
    const result = invoke(cwd, "*.py", "*.yaml", "Dockerfile", "*.css");
    assert.equal(result.status, 0, result.stderr);
  });
});

test("CLI treats shell heredoc data as data but does not mistake quoted delimiters for heredocs", () => {
  withWorkspace((cwd) => {
    writeFileSync(
      path.join(cwd, "data.sh"),
      "#!/bin/sh\ncat <<'END'\n# heredoc data\nEND\nvalue=$(printf '%s' '# substitution string')\nvalue=\"first\n# multiline string data\nlast\"\ntrue\n",
    );
    assert.equal(invoke(cwd, "data.sh").status, 0);
    writeFileSync(path.join(cwd, "quoted.sh"), "echo '<<END'\n# detached\n\ntrue\n");
    const result = invoke(cwd, "quoted.sh");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /quoted\.sh:2:/u);
  });
});

test("CLI rejects detached and adjacent comments with stable file:line diagnostics", () => {
  withWorkspace((cwd) => {
    writeFileSync(
      path.join(cwd, "app.sh"),
      "#!/bin/sh\nprintf ok\n# detached rationale\n\n# first\n# second\ntrue\n",
    );
    const result = invoke(cwd, "app.sh");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /app\.sh:3: Rework this comment:/u);
    assert.match(result.stderr, /app\.sh:5: Rework this comment:/u);
    assert.equal((result.stderr.match(/app\.sh:/gu) ?? []).length, 2);
  });
});

test("CLI accepts only the documented syntax-owned exceptions", () => {
  withWorkspace((cwd) => {
    writeFileSync(path.join(cwd, "valid.sh"), "#!/bin/sh\n# shellcheck disable=SC2086\ntrue\n");
    writeFileSync(path.join(cwd, "valid.py"), "# coding: utf-8\nvalue = 1\n");
    writeFileSync(
      path.join(cwd, "valid.yaml"),
      "# yaml-language-server: $schema=https://example.test/schema.json\nname: app\n",
    );
    writeFileSync(
      path.join(cwd, "Dockerfile"),
      "# syntax=docker/dockerfile:1\nFROM alpine\n# hadolint ignore=DL3008\nRUN echo ok\n",
    );
    writeFileSync(path.join(cwd, "valid.toml"), "# SPDX-License-Identifier: MIT\nname = 'app'\n");
    writeFileSync(
      path.join(cwd, "valid.css"),
      "/* eslint-disable no-unknown-property */\n.x {}\n/*# sourceMappingURL=valid.css.map */\n.y {}\n",
    );
    assert.equal(
      invoke(cwd, "valid.sh", "valid.py", "valid.yaml", "Dockerfile", "valid.toml", "valid.css")
        .status,
      0,
    );
    writeFileSync(path.join(cwd, "invalid.sh"), "# shellcheck disable=SC2086 prose\ntrue\n");
    const result = invoke(cwd, "invalid.sh");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid\.sh:1:/u);
  });
});

test("CLI applies exact directive exceptions and reports prose beside a directive", () => {
  withWorkspace((cwd) => {
    writeFileSync(
      path.join(cwd, "rules.sh"),
      "#!/bin/sh\n# shellcheck disable=SC2086\n# rationale should not attach to suppression\nvalue=1\n",
    );
    const result = invoke(cwd, "rules.sh");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rules\.sh:2:/u);
  });
});

test("CLI checks TOML and CSS and preserves CRLF diagnostic line numbers", () => {
  withWorkspace((cwd) => {
    writeFileSync(
      path.join(cwd, "settings.toml"),
      "name = 'app'\r\n# detached\r\n\r\nvalue = 2\r\n",
    );
    writeFileSync(
      path.join(cwd, "styles.css"),
      ".root {}\n/* detached */\n\n.x {}\n.x { color: red; /* multiline\ncontinued */ }\n",
    );
    const result = invoke(cwd, "*.toml", "*.css");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /settings\.toml:2:/u);
    assert.match(result.stderr, /styles\.css:2:/u);
    assert.match(result.stderr, /styles\.css:5:/u);
  });
});

test("CLI reports missing globs and rejects options rather than silently passing", () => {
  withWorkspace((cwd) => {
    assert.equal(invoke(cwd, "missing-*.toml").status, 1);
    assert.equal(invoke(cwd, "--ignore").status, 1);
  });
});

test("default git selection includes hidden tracked files and excludes ignored files", () => {
  withWorkspace((cwd) => {
    spawnSync("git", ["init", "-q"], { cwd });
    writeFileSync(path.join(cwd, ".gitignore"), "ignored/\n");
    mkdirSync(path.join(cwd, "ignored"));
    writeFileSync(path.join(cwd, ".github/workflows/ci.yml"), "# detached\nname: CI\n");
    writeFileSync(path.join(cwd, "ignored/noise.toml"), "# ignored\nname = 'x'\n");
    spawnSync("git", ["add", ".github/workflows/ci.yml", ".gitignore"], { cwd });
    const result = invoke(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.github\/workflows\/ci\.yml:1/u);
    assert.doesNotMatch(result.stderr, /ignored/u);
  });
});
