import { featureFixture } from "./feature-fixtures.ts";
import { expect, it } from "@effect/vitest";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain";
import { Schema } from "effect";
import { renderRegistry } from "../index.ts";

it("renders reverse callers, reasons, closures and way exposure without running anything", () => {
  const base = {
    description: "Test",
    input: NoInput,
    output: Schema.Void,
    failure: Schema.Never,
    permission: null,
  } as const;
  const child = defineOperation("child", { ...base, permission: "items:read" });
  const root = defineOperation("root", { ...base, edges: [asSystem(child, "background read")] });
  const second = defineOperation("second", { ...base, edges: [child] });
  const feature = featureFixture(root);
  const data = {
    mounts: [{ service: "test", operations: [second] }],
    features: [feature],
    ways: [{ name: "web", protocol: "http" as const, path: "/api", features: [feature] }],
  };
  const rendered = renderRegistry(data);
  expect(rendered).toBe(renderRegistry(data));
  expect(rendered).toContain("Called by: root, second");
  expect(rendered).toContain("⚙ child (system: background read)");
  expect(rendered).toContain("Person closure: none");
  expect(rendered).toContain("System closure: items:read");
  expect(rendered).toContain("Exposed by: web (http: /api)");
  expect(rendered).not.toContain("Defined by");
  expect(rendered).toContain("## Features");
  expect(rendered).toContain("## Operations");
  expect(rendered).not.toContain("## Nodes");
});
