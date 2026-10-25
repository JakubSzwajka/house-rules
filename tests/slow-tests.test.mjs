import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { collectTests, renderSummary } from "../scripts/slow-tests.mjs";

const script = new URL("../scripts/slow-tests.mjs", import.meta.url).pathname;
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "slow-tests-"));
  const write = (path, value) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  return { root, write };
};

describe("slow test summary", () => {
  it("combines Vitest and Node timings, sorts by duration and escapes table cells", () => {
    const { root, write } = fixture();
    write("package.json", { name: "root" });
    write("coverage/slow-tests/slow-node-tests.json", {
      tests: [{ file: resolve(root, "tests/root.test.mjs"), name: "root slow", duration: 2000 }],
    });
    for (const folder of ["packages/a", "examples/booking/apps/api"]) {
      write(`${folder}/package.json`, { name: folder });
      write(`coverage/slow-tests/${folder}/slow-tests.json`, {
        testResults: [
          {
            name: resolve(root, folder, "src/tests/example.test.ts"),
            assertionResults: [
              { fullName: "suite > slow | `test`\nnext", duration: 1001 },
              { fullName: "not over the threshold", duration: 1000 },
              { fullName: "skipped" },
            ],
          },
        ],
      });
    }
    const results = collectTests(root);
    assert.equal(results.reports, 3);
    assert.equal(results.tests.length, 5);
    assert.equal(results.tests[0].duration, 2000);
    const summary = renderSummary(results);
    assert.match(summary, /3 over 1000 ms/u);
    assert.match(summary, /root \| tests\/root.test.mjs \| root slow \| 2000.0/u);
    assert.match(summary, /suite &gt; slow &#124; &#96;test&#96; next/u);
    assert.doesNotMatch(summary, /not over the threshold|skipped/u);
  });

  it("keeps good reports when another is malformed, and handles no reports", () => {
    const { root, write } = fixture();
    assert.match(renderSummary(collectTests(root)), /0 timing reports/u);
    write("coverage/slow-tests/packages/broken/slow-tests.json", "{broken");
    assert.equal(collectTests(root).warnings.length, 1);
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...childEnv, GITHUB_STEP_SUMMARY: resolve(root, "summary.md") },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(resolve(root, "summary.md"), "utf8"), /Could not read/u);
  });

  it("never fails when the GitHub summary is unwritable", () => {
    const { root } = fixture();
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...childEnv, GITHUB_STEP_SUMMARY: root },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /summary unavailable/u);
  });

  it("records Node test durations only in CI without changing test status", () => {
    const { root, write } = fixture();
    write("package.json", { name: "node-fixture", type: "module" });
    write("scripts/slow-tests.mjs", readFileSync(script, "utf8"));
    const reporter = resolve(root, "scripts/slow-tests.mjs");
    write("example.test.mjs", 'import { test } from "node:test"; test("example", () => {});');
    for (const ci of ["", "true"]) {
      const result = spawnSync(
        process.execPath,
        [
          "--test",
          "--test-reporter=spec",
          `--test-reporter=${reporter}`,
          "--test-reporter-destination=stdout",
          "--test-reporter-destination=stdout",
          "example.test.mjs",
        ],
        { cwd: root, env: { ...childEnv, CI: ci }, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /example/u);
      const reports = collectTests(root);
      assert.equal(reports.reports, ci ? 1 : 0);
      if (ci) {
        assert.equal(reports.tests.length, 1);
        assert.equal(reports.tests[0].name, "example");
      }
    }
    write(
      "example.test.mjs",
      'import { test } from "node:test"; test("fails", () => { throw Error("expected"); });',
    );
    const failure = spawnSync(
      process.execPath,
      ["--test", `--test-reporter=${reporter}`, "example.test.mjs"],
      {
        cwd: root,
        env: { ...childEnv, CI: "true" },
        encoding: "utf8",
      },
    );
    assert.equal(failure.status, 1);
    assert.ok(collectTests(root).tests.some((test) => test.name === "fails"));
  });

  it("every Vitest workspace has CI-only JSON reporting and a 1000 ms slow threshold", () => {
    const root = new URL("../", import.meta.url);
    for (const path of globSync(["packages/*/vitest.config.ts", "examples/**/vitest.config.ts"], {
      cwd: root,
      exclude: ["**/node_modules/**"],
    })) {
      const config = readFileSync(new URL(path, root), "utf8");
      assert.match(config, /slowTestThreshold: 1000/u, path);
      assert.match(
        config,
        /reporters: process.env.CI \? \["default", "json"\] : \["default"\]/u,
        path,
      );
      const output = config.match(/json: "([^"]+)"/u)?.[1];
      assert.equal(
        resolve(root.pathname, dirname(path), output),
        resolve(root.pathname, "coverage/slow-tests", dirname(path), "slow-tests.json"),
        path,
      );
    }
  });
});
