import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin, { capabilityConfig } from "../src/index.mjs";

function lint(
  code,
  filename = "packages/bookings/src/booking/loader.ts",
  config = plugin.configs.capability,
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

// Dependency Cruiser records no edge for import(at), so contract-entry-is-browser-safe cannot see
// where it leads. This rule keeps every import a package makes visible to the graph checks.
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

test("covers every package source file, and leaves tests and apps alone", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  assert.deepEqual(lint(code, "packages/bookings/src/contract.ts"), [2]);
  assert.deepEqual(lint(code, "packages/bookings/src/adapters/postgres/booking.ts"), [2]);
  assert.deepEqual(lint(code, "packages/bookings/src/booking/tests/booking.test.ts"), []);
  assert.deepEqual(lint(code, "apps/web/src/delivery/pages.ts"), []);
});

// layout({ packagesDir: "libs" }) follows contract entries under libs/, so the lint rule must too.
test("capabilityConfig({ packagesDir }) covers the same packages root layout() does", () => {
  const code = "const at = './x.ts';\nawait import(at);";
  const libs = capabilityConfig({ packagesDir: "libs" });
  assert.deepEqual(lint(code, "libs/a/src/contract.ts", libs), [2]);
  assert.deepEqual(lint(code, "libs/a/src/tests/a.test.ts", libs), []);
  assert.deepEqual(lint(code, "packages/a/src/contract.ts", libs), []);
  assert.deepEqual(lint(code, "libs/a/src/contract.ts"), []);
  assert.throws(() => capabilityConfig({ packagesDir: "/libs" }), /packagesDir/u);
  assert.throws(() => capabilityConfig({ packagesDir: "libs/*" }), /packagesDir/u);
});
