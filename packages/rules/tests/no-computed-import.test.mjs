import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Linter } from "eslint";
import plugin, { featuresConfig } from "../src/index.mjs";

function lint(
  code,
  filename = "packages/bookings/src/booking/loader.ts",
  config = plugin.configs.features,
  cwd = process.cwd(),
) {
  const messages = new Linter({ cwd }).verify(code, config, { filename });
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

test("encoding trust requires the exact public Effect import on every import form", () => {
  for (const source of [
    "effect/encoding/index",
    "effect/encoding/index.js",
    "effect/dist/encoding/index.js",
    "../../../node_modules/effect/dist/encoding/index.js",
    "../../../node_modules/.pnpm/effect@4.0.3/node_modules/effect/dist/encoding/index.js",
  ]) {
    for (const statement of [
      `import * as Encoding from "${source}";`,
      `import type * as Encoding from "${source}";`,
      `export * from "${source}";`,
      `export { Base64Url } from "${source}";`,
      `await import("${source}");`,
      `await import(\`${source}\`);`,
      `require("${source}");`,
    ])
      assert.deepEqual(lint(statement), [1], statement);
  }
  for (const statement of [
    'import { Base64Url } from "effect/encoding";',
    'export { Base64Url } from "effect/encoding";',
    'export * from "effect/encoding";',
    'await import("effect/encoding");',
    "await import(`effect/encoding`);",
    'require("effect/encoding");',
    'import { Schema } from "effect";',
    'import * as Schema from "effect/Schema";',
    'import * as Hex from "effect/encoding/Hex";',
    'import * as Base64Url from "effect/encoding/Base64Url";',
    'import { encoding } from "./cursor/encoding.js";',
    'import { encoding } from "./effect/encoding/index.js";',
    'import { encoding } from "./effect/dist/encoding/index.js";',
  ])
    assert.deepEqual(lint(statement), [], statement);
});

test("a file alias cannot borrow the resolved encoding barrel's browser trust", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "encoding-provenance-"));
  try {
    const module = path.join(cwd, "node_modules/effect/dist/encoding/index.js");
    const folder = path.join(cwd, "packages/a/src/cursor");
    mkdirSync(path.dirname(module), { recursive: true });
    mkdirSync(folder, { recursive: true });
    writeFileSync(module, "export const Base64Url = {};\n");
    symlinkSync(module, path.join(folder, "codec.js"));
    for (const source of ["./codec.js", "../../../../node_modules/effect/dist/encoding/index.js"])
      assert.deepEqual(
        lint(
          `export * from "${source}";`,
          "packages/a/src/cursor/cursor.ts",
          plugin.configs.features,
          cwd,
        ),
        [1],
        source,
      );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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
