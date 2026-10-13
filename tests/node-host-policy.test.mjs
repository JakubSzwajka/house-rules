import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("only the plain Node host uses strict.json; Effect app code still fails nodeBuiltinImport", () => {
  const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  assert.equal(
    read("../packages/node-host/tsconfig.json").extends,
    "@house-rules/rules/tsconfig/strict.json",
  );
  assert.equal(read("../apps/api/tsconfig.json").extends, "../../tsconfig.base.json");
  const result = spawnSync(
    "pnpm",
    ["exec", "tsc", "--project", "tests/fixtures/node-builtin/tsconfig.json"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /nodeBuiltinImport/u);
  assert.match(result.stdout + result.stderr, /uses the `http` module/u);
});
