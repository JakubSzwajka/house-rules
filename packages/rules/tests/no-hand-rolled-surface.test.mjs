import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const DELIVERY = "apps/api/src/delivery/mcp/tools.ts";

function lint(code, filename = DELIVERY, options) {
  const config = plugin.configs.capability.map((entry) => ({
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

test("passes toTool, Toolkit.make, other modules, and shadowed names", () => {
  const code = `import { toTool } from "@house-rules/capability";
import { Toolkit } from "effect/unstable/ai";
import { Tool } from "./local-tool";
import type { Rpc } from "effect/unstable/rpc";
const ShowBooking = toTool(showBooking.contract, { title: "Show", idempotent: true, openWorld: false });
Toolkit.make(ShowBooking);
Tool.make("local");
function inner(HttpApiEndpoint) {
  return HttpApiEndpoint.get("x");
}`;
  assert.deepEqual(lint(code), []);
});

test("allows packages/capability by default, and honours a custom allow list", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping");';
  assert.deepEqual(lint(code, "packages/capability/src/to-tool.ts"), []);
  assert.deepEqual(
    lint(code, "packages/surfaces/src/tool.ts", { allow: ["packages/surfaces/**"] }),
    [],
  );
  assert.deepEqual(lint(code, "packages/capability/src/to-tool.ts", { allow: [] }), [
    ["Tool.make", 2],
  ]);
});

test("the message points at toTool", () => {
  assert.match(
    plugin.rules["no-hand-rolled-surface"].meta.messages.handRolled,
    /from its contract with toTool/,
  );
});

test("the capability preset runs it on JavaScript files too", () => {
  const code = 'import { Tool } from "effect/unstable/ai";\nTool.make("ping", {});';
  for (const extension of ["js", "jsx", "mjs", "cjs", "ts", "mts", "cts", "tsx"]) {
    const messages = new Linter().verify(code, plugin.configs.capability, {
      filename: `apps/api/src/delivery/mcp/tools.${extension}`,
    });
    assert.deepEqual(
      messages.map(({ ruleId, line }) => [ruleId, line]),
      [["house-rules/no-hand-rolled-surface", 2]],
      extension,
    );
  }
});

test("the capability preset keeps use-case-is-capability on TypeScript files", () => {
  const code = "export const x = 1;";
  const ruleIds = (filename) =>
    new Linter().verify(code, plugin.configs.capability, { filename }).map(({ ruleId }) => ruleId);
  assert.deepEqual(ruleIds("apps/api/src/use-cases/bad.mjs"), []);
  assert.deepEqual(ruleIds("apps/api/src/use-cases/bad.ts"), [
    "house-rules/use-case-is-capability",
    "house-rules/use-case-is-capability",
  ]);
});
