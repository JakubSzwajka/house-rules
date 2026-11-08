import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const SERVER = "apps/api/src/mcp/tools.ts";

function lint(code, filename = SERVER, options) {
  const config = plugin.configs.workspace.map((entry) => ({
    ...entry,
    rules: entry.rules["house-rules/no-hand-rolled-surface"]
      ? { "house-rules/no-hand-rolled-surface": options ? ["error", options] : "error" }
      : {},
  }));
  const messages = new Linter().verify(code, config, { filename });
  assert.equal(
    messages.some((message) => message.fatal),
    false,
    messages.map((message) => message.message).join("\n"),
  );
  return messages.map(({ message, line }) => [message.split(" ")[0], line]);
}

test("flags Tool.make, Rpc.make and HttpApiEndpoint methods from their barrels", () => {
  const code = `import { Tool } from "effect/unstable/ai";
import { Rpc } from "effect/unstable/rpc";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
Tool.make("ping", {});
Rpc.make("ping");
HttpApiEndpoint.get("ping", "/ping");
HttpApiEndpoint.post("ping", "/ping");
HttpApiEndpoint["delete"]("ping", "/ping");`;
  assert.deepEqual(lint(code), [
    ["Tool.make", 4],
    ["Rpc.make", 5],
    ["HttpApiEndpoint.get", 6],
    ["HttpApiEndpoint.post", 7],
    ["HttpApiEndpoint.delete", 8],
  ]);
});

test("flags module namespace imports, barrel namespaces, named functions, aliases and .call", () => {
  const code = `import * as Ai from "effect/unstable/ai";
import * as Tool from "effect/unstable/ai/Tool";
import { make as makeRpc } from "effect/unstable/rpc/Rpc";
import { Tool as T } from "effect/unstable/ai";
Ai.Tool.make("a");
Tool.make("b");
makeRpc("c");
T.make.call(undefined, "d");
(T.make as typeof T.make)("e");`;
  assert.deepEqual(lint(code), [
    ["Tool.make", 5],
    ["Tool.make", 6],
    ["Rpc.make", 7],
    ["Tool.make", 8],
    ["Tool.make", 9],
  ]);
});

test("stable Effect paths fence barrels, deep imports and namespaces too", () => {
  const code = `import { Tool } from "effect/ai";
import * as Ai from "effect/ai";
import * as DeepTool from "effect/ai/Tool";
import { make as makeRpc } from "effect/rpc/Rpc";
import { HttpApiEndpoint } from "effect/http-api";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
Tool.make("a");
Ai.Tool.make("b");
DeepTool.make("c");
makeRpc("d");
HttpApiEndpoint.get("e", "/e");
Endpoint.post("f", "/f");`;
  assert.deepEqual(lint(code), [
    ["Tool.make", 7],
    ["Tool.make", 8],
    ["Tool.make", 9],
    ["Rpc.make", 10],
    ["HttpApiEndpoint.get", 11],
    ["HttpApiEndpoint.post", 12],
  ]);
});

test("passes Domain.Api serving, Toolkit.make, other modules, and shadowed names", () => {
  const code = `import * as Http from "@alchemy.run/domain/Http";
import { Toolkit } from "effect/unstable/ai";
import { Tool } from "./local-tool";
import type { Rpc } from "effect/unstable/rpc";
const served = Http.serve(BookingApi);
Toolkit.make(served);
Tool.make("local");
function inner(HttpApiEndpoint) {
  return HttpApiEndpoint.get("x");
}`;
  assert.deepEqual(lint(code), []);
});

test("allows nothing by default, and honours a custom allow list", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping");';
  assert.deepEqual(plugin.rules["no-hand-rolled-surface"].meta.defaultOptions, [{ allow: [] }]);
  assert.deepEqual(
    lint(code, "packages/surfaces/src/tool.ts", { allow: ["packages/surfaces/**"] }),
    [],
  );
  for (const file of [
    "packages/surfaces/src/tool.ts",
    "packages/stack/src/mcp/tool.ts",
    "examples/booking/apps/server/src/main.ts",
  ])
    assert.deepEqual(lint(code, file), [["Tool.make", 2]], file);
});

test("the message points at the Domain.Api", () => {
  assert.match(
    plugin.rules["no-hand-rolled-surface"].meta.messages.handRolled,
    /serve its Domain\.Api/,
  );
});

test("the workspace preset runs it on JavaScript files too", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping", {});';
  for (const extension of ["js", "jsx", "mjs", "cjs", "ts", "mts", "cts", "tsx"]) {
    const messages = new Linter().verify(code, plugin.configs.workspace, {
      filename: `apps/api/src/mcp/tools.${extension}`,
    });
    assert.deepEqual(
      messages.map(({ ruleId, line }) => [ruleId, line]),
      [["house-rules/no-hand-rolled-surface", 2]],
      extension,
    );
  }
});
