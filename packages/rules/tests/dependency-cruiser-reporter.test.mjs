import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const depcruise = path.join(
  repositoryRoot,
  "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
);

// The See line only prints under the `err-long` reporter, so the flag is read from the root `deps` script.
const reporterFlag = async () => {
  const { scripts } = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const match = /(?:--output-type|-T)[ =](\S+)/.exec(scripts.deps);
  assert.ok(match, `the root deps script names no reporter: ${scripts.deps}`);
  return ["--output-type", match[1]];
};

describe("root deps script reporter", () => {
  it("prints the See line of a failing owned rule", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "house-rules-reporter-"));
    try {
      const cycle = path.join(workspace, "packages/a/src/cyclic");
      await mkdir(cycle, { recursive: true });
      await writeFile(path.join(cycle, "a.js"), 'import "./b.js";\n');
      await writeFile(path.join(cycle, "b.js"), 'import "./a.js";\n');
      const result = spawnSync(
        process.execPath,
        [
          depcruise,
          "--config",
          path.join(repositoryRoot, ".dependency-cruiser.cjs"),
          ...(await reporterFlag()),
          "packages",
        ],
        { cwd: workspace, encoding: "utf8" },
      );
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(
        `${result.stdout}${result.stderr}`.includes(
          "See https://stack.kubaszwajka.com/rules/#no-cycles",
        ),
        result.stdout,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
