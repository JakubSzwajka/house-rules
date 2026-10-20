import { expect, it } from "@effect/vitest";
import { asSystem, defineNode, NoInput } from "@house-rules/domain";
import { Schema } from "effect";
import { defineEntry, renderRegistry } from "../index.ts";

it("renders reverse callers, reasons, closures and way exposure without running anything", () => {
  const base = {
    description: "Test",
    input: NoInput,
    output: Schema.Void,
    failure: Schema.Never,
    permission: null,
  } as const;
  const child = defineNode("child", { ...base, permission: "items:read" });
  const root = defineNode("root", { ...base, edges: [asSystem(child, "background read")] });
  const second = defineNode("second", { ...base, edges: [child] });
  const entry = defineEntry(root);
  const data = {
    nodes: [root, second],
    entries: [entry],
    ways: [{ name: "web", path: "/api", entries: [entry] }],
  };
  const rendered = renderRegistry(data);
  expect(rendered).toBe(renderRegistry(data));
  expect(rendered).toContain("Called by: root, second");
  expect(rendered).toContain("⚙ child (system: background read)");
  expect(rendered).toContain("Person closure: none");
  expect(rendered).toContain("System closure: items:read");
  expect(rendered).toContain("Exposed by: web (/api)");
  expect(rendered).not.toContain("Defined by");
});
