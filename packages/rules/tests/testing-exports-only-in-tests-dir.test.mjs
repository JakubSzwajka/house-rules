import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const RULE = "house-rules/testing-exports-only-in-tests";

test("a custom testsDir counts as a test folder, as it does for layout()", () => {
  const code = `import { DbTesting } from "@board/db";
export const layer = DbTesting.layer({ label: "x" });`;
  const lintWith = (options, filename) =>
    new Linter()
      .verify(code, [...plugin.configs.testing, { rules: { [RULE]: ["error", ...options] } }], {
        filename,
      })
      .map(({ ruleId, message }) => [ruleId, message]);

  const specFile = "packages/db/src/spec/support.ts";
  assert.deepEqual(lintWith([{ testsDir: "spec" }], specFile), []);
  assert.deepEqual(lintWith([{ testsDir: "checks/unit" }], "packages/db/src/checks/unit/x.ts"), []);
  assert.deepEqual(lintWith([{ testsDir: "spec" }], "packages/db/src/tests/support.ts"), []);
  assert.deepEqual(lintWith([{ testsDir: "tests" }], "packages/db/src/__tests__/x.ts"), []);
  assert.deepEqual(lintWith([], specFile), [
    [
      RULE,
      "DbTesting is a testing export. Import it only in a test file (under tests/, test/ or __tests__/, or named *.test.* or *.spec.*), or in testing code whose runtime exports are all named *Testing.",
    ],
  ]);
  assert.deepEqual(lintWith([{ testsDir: "spec" }], "packages/db/src/inspector/x.ts"), [
    [
      RULE,
      "DbTesting is a testing export. Import it only in a test file (under tests/, test/, __tests__/ or spec/, or named *.test.* or *.spec.*), or in testing code whose runtime exports are all named *Testing.",
    ],
  ]);
  assert.equal(lintWith([{ testsDir: "s.ec" }], "packages/db/src/spec/x.ts").length, 1);
  for (const testsDir of ["", "/spec", "spec/"]) {
    assert.throws(() => lintWith([{ testsDir }], specFile), /should match pattern/u, testsDir);
  }
  assert.throws(() => lintWith([{ testDir: "spec" }], specFile), /additional properties/u);
});
