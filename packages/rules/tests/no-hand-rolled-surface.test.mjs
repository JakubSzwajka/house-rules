import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const WAY = "apps/api/src/ways-in/mcp/tools.ts";

function lint(code, filename = WAY, options) {
  const config = plugin.configs.features.map((entry) => ({
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

test("passes defineWay, Toolkit.make, other modules, and shadowed names", () => {
  const code = `import { defineWay } from "@house-rules/application";
import { Toolkit } from "effect/unstable/ai";
import { Tool } from "./local-tool";
import type { Rpc } from "effect/unstable/rpc";
const ShowBooking = defineWay({ entries: [showBookingEntry] });
Toolkit.make(ShowBooking);
Tool.make("local");
function inner(HttpApiEndpoint) {
  return HttpApiEndpoint.get("x");
}`;
  assert.deepEqual(lint(code), []);
});

test("allows packages/application by default, and honours a custom allow list", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping");';
  assert.deepEqual(lint(code, "packages/application/src/ways-in/tool.ts"), []);
  assert.deepEqual(
    lint(code, "packages/surfaces/src/tool.ts", { allow: ["packages/surfaces/**"] }),
    [],
  );
  assert.deepEqual(lint(code, "packages/application/src/ways-in/tool.ts", { allow: [] }), [
    ["Tool.make", 2],
  ]);
});

test("the default allow list is the application package only, and refuses the retired capability package", () => {
  assert.deepEqual(plugin.rules["no-hand-rolled-surface"].meta.defaultOptions, [
    { allow: ["packages/application/**"] },
  ]);
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping");';
  assert.deepEqual(lint(code, "packages/capability/src/contract/to-tool.ts"), [["Tool.make", 2]]);
  assert.deepEqual(lint(code, "packages/domain/src/module/define-module.ts"), [["Tool.make", 2]]);
});

test("the message points at the router", () => {
  assert.match(
    plugin.rules["no-hand-rolled-surface"].meta.messages.handRolled,
    /let the router build the surface/,
  );
});

test("the nodes preset runs it on JavaScript files too", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping", {});';
  for (const extension of ["js", "jsx", "mjs", "cjs", "ts", "mts", "cts", "tsx"]) {
    const messages = new Linter().verify(code, plugin.configs.features, {
      filename: `apps/api/src/ways-in/mcp/tools.${extension}`,
    });
    assert.deepEqual(
      messages.map(({ ruleId, line }) => [ruleId, line]),
      [["house-rules/no-hand-rolled-surface", 2]],
      extension,
    );
  }
});

test("the features preset checks TypeScript feature files", () => {
  const code = "export const x = 1;";
  const ruleIds = (filename) =>
    new Linter().verify(code, plugin.configs.features, { filename }).map(({ ruleId }) => ruleId);
  assert.deepEqual(ruleIds("apps/api/src/features/bad/node.mjs"), ["house-rules/feature-file"]);
  assert.deepEqual(ruleIds("apps/api/src/features/bad/index.ts"), ["house-rules/feature-file"]);
});
