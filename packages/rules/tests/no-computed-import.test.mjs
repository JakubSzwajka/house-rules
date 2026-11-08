import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin, { workspaceConfig } from "../src/index.mjs";

function lint(
  code,
  filename = "packages/bookings/src/booking/loader.ts",
  config = plugin.configs.workspace,
) {
  const messages = new Linter().verify(code, config, { filename });
  assert.equal(
    messages.some((message) => message.fatal),
    false,
    messages.map((message) => message.message).join("\n"),
  );
  return messages
    .filter(({ ruleId }) => ruleId === "house-rules/no-computed-import")
    .map(({ line }) => line);
}

test("flags an import() or require() whose specifier is computed", () => {
  const code = `const at = "./loader.ts";
await import(at);
await import(\`./\${at}\`);
await import("./" + at);
require(at);
await import("./booking.ts");
await import(\`./booking.ts\`);
require("./booking.ts");`;
  assert.deepEqual(lint(code), [2, 3, 4, 5]);
});

test("covers package and app source trees, but not tests", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  for (const filename of [
    "packages/bookings/src/index.ts",
    "packages/bookings/src/adapters/postgres/booking.ts",
    "apps/web/src/booking/book.command.ts",
    "apps/web/src/server/endpoints.ts",
  ])
    assert.deepEqual(lint(code, filename), [2]);
  assert.deepEqual(lint(code, "packages/bookings/src/booking/tests/booking.test.ts"), []);
});

test("workspaceConfig roots match layout roots", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  const libs = workspaceConfig({ packagesDir: "libs" });
  assert.deepEqual(lint(code, "libs/a/src/index.ts", libs), [2]);
  assert.deepEqual(lint(code, "libs/a/src/tests/a.test.ts", libs), []);
  assert.deepEqual(lint(code, "packages/a/src/index.ts", libs), []);
  assert.deepEqual(lint(code, "libs/a/src/index.ts"), []);
  assert.throws(() => workspaceConfig({ packagesDir: "/libs" }), /packagesDir/u);
  assert.throws(() => workspaceConfig({ packagesDir: "libs/*" }), /packagesDir/u);
});
