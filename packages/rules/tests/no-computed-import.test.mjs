import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin, { featuresConfig } from "../src/index.mjs";

function lint(
  code,
  filename = "packages/bookings/src/booking/loader.ts",
  config = plugin.configs.features,
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
  const code = `const at = "./facade.ts";
await import(at);
await import(\`./\${at}\`);
await import("./" + at);
require(at);
await import("./booking.ts");
await import(\`./booking.ts\`);
require("./booking.ts");`;
  assert.deepEqual(lint(code), [2, 3, 4, 5]);
});

test("covers package and app descriptor trees, but not tests", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  for (const filename of [
    "packages/bookings/src/contract.ts",
    "packages/bookings/src/adapters/postgres/booking.ts",
    "apps/web/src/features/show/node.ts",
    "apps/web/src/modules/books/contract.ts",
    "apps/web/src/ways-in/web/endpoints.ts",
  ])
    assert.deepEqual(lint(code, filename), [2]);
  assert.deepEqual(lint(code, "packages/bookings/src/booking/tests/booking.test.ts"), []);
});

test("featuresConfig roots match layout roots", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  const libs = featuresConfig({ packagesDir: "libs" });
  assert.deepEqual(lint(code, "libs/a/src/contract.ts", libs), [2]);
  assert.deepEqual(lint(code, "libs/a/src/tests/a.test.ts", libs), []);
  assert.deepEqual(lint(code, "packages/a/src/contract.ts", libs), []);
  assert.deepEqual(lint(code, "libs/a/src/contract.ts"), []);
  assert.throws(() => featuresConfig({ packagesDir: "/libs" }), /packagesDir/u);
  assert.throws(() => featuresConfig({ packagesDir: "libs/*" }), /packagesDir/u);
});
