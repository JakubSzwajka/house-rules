import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const BIN = "packages/rules/bin";
const RULE = "house-rules/no-computed-import";

async function computedImports(cwd) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: join(repositoryRoot, "eslint.config.mjs"),
  });
  const results = await eslint.lintFiles([`${BIN}/**/*.{js,mjs,cjs}`]);
  const fromCwd = (filePath) => relative(cwd, filePath).replaceAll("\\", "/");
  return {
    files: results.map(({ filePath }) => fromCwd(filePath)),
    reports: results.flatMap(({ filePath, messages }) =>
      messages
        .filter(({ ruleId }) => ruleId === RULE)
        .map(({ line }) => `${fromCwd(filePath)}:${line}`),
    ),
  };
}

describe("@house-rules/rules bins load nothing by a computed path", () => {
  it("lints every bin with no-computed-import and finds none", async () => {
    const { files, reports } = await computedImports(repositoryRoot);
    const bins = readdirSync(join(repositoryRoot, BIN)).filter((name) =>
      /[.](?:mjs|cjs|js)$/u.test(name),
    );
    assert.ok(bins.length > 0);
    assert.deepEqual(files.toSorted(), bins.map((name) => `${BIN}/${name}`).toSorted());
    assert.deepEqual(reports, []);
  });

  it("reports a planted computed import() and require() in a copy of bin/", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "house-rules-bin-computed-"));
    try {
      await cp(join(repositoryRoot, BIN), join(workspace, BIN), { recursive: true });
      await writeFile(
        join(workspace, BIN, "review-computed.mjs"),
        'const target = "../../../apps/api/src/main.ts";\nexport const leak = () => import(target);\n',
      );
      await writeFile(
        join(workspace, BIN, "review-required.cjs"),
        'const name = "@house-rules/domain";\nmodule.exports = require(name);\n',
      );
      const { reports } = await computedImports(workspace);
      assert.deepEqual(reports.toSorted(), [
        `${BIN}/review-computed.mjs:2`,
        `${BIN}/review-required.cjs:2`,
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
