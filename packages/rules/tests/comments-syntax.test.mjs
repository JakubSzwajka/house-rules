import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { invoke, withWorkspace } from "./comments-workspace.mjs";

const rejected = [
  ["CSS adjacent", "x.css", ".a {}\n/* one */\n/* two */\n.b {}", [2]],
  ["CSS header group", "x.css", "/* one */\n/* two */\n.b {}", [1]],
  ["CSS same-line narrative", "x.css", ".a {}\n/* one */ /* two */ .b {}", [2]],
  ["CSS multiline control", "x.css", ".a {}\n/* eslint-disable\n prose\n*/\n.b {}", [2]],
  ["CSS multiline map", "x.css", "/*# sourceMappingURL=x\n prose\n*/\n.b {}", [1]],
  ["CSS multiline license", "x.css", "/* @license\n arbitrary narrative\n*/\n.b {}", [1]],
  ["Docker prose directive", "Dockerfile", "FROM alpine\n# check=this is prose\nRUN true", [2]],
  [
    "Docker detached directive",
    "Dockerfile",
    "FROM alpine\n# syntax=docker/dockerfile:1\n\nRUN true",
    [2],
  ],
  ["Docker invalid header", "Dockerfile", "# syntax=long narrative\nFROM alpine", [1]],
  [
    "Docker directive neighbor",
    "Dockerfile",
    "# syntax=docker/dockerfile:1\n# narrative\nFROM alpine",
    [1],
  ],
  ["Docker prior prose", "Dockerfile", "FROM alpine\n# narrative\n# check=prose\nRUN true", [2]],
  [
    "Docker duplicate directive key",
    "Dockerfile",
    "# syntax=docker/dockerfile:1\n# syntax=docker/dockerfile:1.7\nFROM alpine",
    [1],
  ],
  [
    "unsupported Docker BuildKit heredoc body",
    "Dockerfile",
    "FROM alpine\nRUN <<EOF\n# body data\n# more body data\nEOF\n# one\n# two\nRUN true",
    [3, 6],
  ],
  [
    "unsupported Docker BuildKit tab-stripped COPY heredoc body",
    "Dockerfile",
    "FROM alpine\nCOPY <<-EOF /data\n\t# body data\n\t# more body data\n\tEOF\n# one\n# two\nRUN true",
    [3, 6],
  ],
  ["YAML shebang", "x.yaml", "#!/bin/sh\nname: app", [1]],
  ["TOML shebang", "x.toml", "#!/bin/sh\nname = 'app'", [1]],
  ["Invalid shebang", "x.sh", "#!/x any prose\ntrue", [1]],
  ["Indented shebang", "x.py", " #!/usr/bin/python3\nvalue = 1", [1]],
  ["SPDX narrative", "x.py", "# SPDX-License-Identifier: MIT plus narrative\nvalue = 1", [1]],
  ["Cookie wrapper", "x.py", "# arbitrary coding: utf-8 prose\nvalue = 1", [1]],
  ["Cookie after code", "x.py", "value = 1\n# coding: utf-8\n\nvalue = 2", [2]],
  ["YAML fake scalar", "x.yml", "name: x # see: >\n  # one\n  # two\n  value: 1", [2]],
  ["YAML apostrophe", "x.yml", "name: don't # first\n# second\n# third\nvalue: 1", [2]],
  ["YAML data tail", "x.yml", 'name: "x" # see: |\n  # one\n  # two\n  value: 1', [2]],
  [
    "workflow scalar mapping sibling",
    ".github/workflows/ci.yml",
    "steps:\n  - run: |\n      echo\n    name: x\n    # one\n    # two\n    env: {}",
    [5],
  ],
  [
    "workflow comments directly after scalar data",
    ".github/workflows/ci.yml",
    "steps:\n  - run: |\n      # data\n      # more data\n      echo ok\n    # one\n    # two\n    env: {}",
    [6],
  ],
  [
    "workflow groups before and after scalar data",
    ".github/workflows/ci.yml",
    "steps:\n  - name: x\n    # one\n    # two\n    run: |\n      # data\n      # more data\n      echo ok\n    # three\n    # four\n    env: {}",
    [3, 9],
  ],
  [
    "YAML nested sequence mapping scalar",
    "x.yml",
    "steps:\n  - - run: >2-\n        # data\n        # more data\n      name: x\n      # one\n      # two\n      env: {}",
    [6],
  ],
  ["Shell shift", "x.sh", "value=$((1 << 2))\n# one\n# two\ntrue", [2]],
  ["Shell arithmetic command", "x.sh", "(( value = 1 << 2 ))\n# one\n# two\ntrue", [2]],
  ["Shell herestring", "x.sh", "cat <<<word\n# one\n# two\ntrue", [2]],
  ["Shell quoted backslash", "x.sh", "printf '%s' 'a\\'\n# one\n# two\ntrue", [2]],
  ["Shell ANSI-C escaped quote", "x.bash", "echo $'it\\'s'\n# one\n# two\ntrue", [2]],
  [
    "Shell ANSI-C escaped dollar is ordinary quote",
    "x.bash",
    "echo \\$'a\\'\n# one\n# two\ntrue",
    [2],
  ],
  ["Shell comment heredoc text", "x.sh", "true # see <<END\n# one\n# two\ntrue", [2]],
];

for (const [name, file, source, expected] of rejected) {
  test(`CLI rejects ${name} at the first failing comment`, () => {
    withWorkspace((cwd) => {
      writeFileSync(path.join(cwd, file), `${source}\n`);
      const result = invoke(cwd, file);
      assert.equal(result.status, 1, result.stdout);
      const lines = [...result.stderr.matchAll(/:(\d+): Rework this comment:/gu)].map((m) =>
        Number(m[1]),
      );
      assert.deepEqual(lines, expected, result.stderr);
    });
  });
}

const accepted = [
  ["CSS local", "x.css", ".a {}\n/* why */\n.b {}"],
  ["CSS leading inline", "x.css", "/* why */ .b {}"],
  ["CSS trailing inline", "x.css", ".b {} /* why */"],
  [
    "Docker directives",
    "Containerfile",
    "# syntax=docker/dockerfile:1\n# escape=`\n# check=skip=JSONArgsRecommended;error=true\nFROM alpine",
  ],
  ["Python emacs cookie", "x.py", "# -*- coding: utf-8 -*-\nvalue = 1"],
  ["Python vim cookie", "x.py", "# vim: set fileencoding=utf-8 :\nvalue = 1"],
  ["Python second cookie", "x.py", "#!/usr/bin/env -S python3 -u\n# coding=utf-8\nvalue = 1"],
  ["Python blank first line", "x.py", "\n# coding: utf-8\nvalue = 1"],
  ["Python strings", "x.py", "'''module docstring\n# string\n'''\nvalue = 1"],
  ["Shell env arguments", "x.sh", "#!/usr/bin/env -S bash -eu -o pipefail\ntrue"],
  ["Shell escaped hash", "x.sh", "\\#not-a-comment\ntrue"],
  [
    "Shell ANSI-C multiline data and closing backslash",
    "x.bash",
    "echo $'it\\'s\n# data\n# more data\nlast\\\\'\n# why\ntrue",
  ],
  [
    "TOML literal string",
    "x.toml",
    "value = '''\n# string\n# more string\n''' # local\nname = 'x'",
  ],
  ["TOML basic string", "x.toml", 'value = """\n# string\n# more string\n""" # local\nname = "x"'],
  ["YAML sequence literal", "x.yml", "steps:\n  - |\n    # data\n    # data\nname: app"],
  ["YAML sequence folded", "x.yml", "steps:\n  - >-2\n    # data\n    # data\nname: app"],
  ["YAML plain apostrophe hash", "x.yml", "name: don't # local\nnext: value"],
  [
    "workflow scalar data and local sibling whys",
    ".github/workflows/ci.yml",
    "steps:\n  - name: x\n    # why\n    run: |\n      # data\n      # more data\n      echo ok\n    # why\n    env: {}\n  - run: >-2\n      # data\n      # more data\n      echo ok\n    # why\n    name: next",
  ],
  [
    "YAML nested sequence scalar and mapping transitions",
    "x.yml",
    "steps:\n  - - |\n      # data\n      # more data\n    - run: |2+\n        # data\n        # more data\n      # why\n      name: next\nname: app",
  ],
];

for (const [name, file, source] of accepted) {
  test(`CLI accepts ${name}`, () => {
    withWorkspace((cwd) => {
      writeFileSync(path.join(cwd, file), `${source}\n`);
      const result = invoke(cwd, file);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /1 file\(s\) checked/u);
    });
  });
}
