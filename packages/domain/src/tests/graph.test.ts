import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  type AnyCallable,
  asSystem,
  buildGraph,
  defineOperation,
  NoInput,
  permissionClosures,
} from "../index.ts";

const read = defineOperation("module.read", {
  description: "Read",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
});
const write = defineOperation("module.write", {
  description: "Write",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: "items:write",
  transactional: true,
});
const root = defineOperation("root", {
  description: "Feature",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
  edges: [read, asSystem(write, "maintain item")],
});

it("returns invalid results for cycles, duplicate names and read-only writes", () => {
  const edges: AnyCallable[] = [];
  const cyclic: AnyCallable = { ...root, edges };
  edges.push(cyclic);
  expect(buildGraph([cyclic])).toEqual({ _tag: "Invalid", reason: "Cycle at root" });
  expect(buildGraph([read, { ...read }])).toEqual({
    _tag: "Invalid",
    reason: "Duplicate callable name module.read",
  });
  expect(buildGraph([{ ...root, readOnly: true }])).toEqual({
    _tag: "Invalid",
    reason: "Read-only root calls write module.write",
  });
});

it("rejects repeated targets in either mode and across modes", () => {
  for (const edges of [
    [read, read],
    [asSystem(read, "first"), asSystem(read, "second")],
    [read, asSystem(read, "system read")],
    [asSystem(read, "system read"), read],
  ]) {
    expect(buildGraph([{ ...root, edges }])).toEqual({
      _tag: "Invalid",
      reason: "Repeated target module.read at root",
    });
  }
});

it("does not throw while defining a dynamic blank reason; graph validation refuses it", () => {
  for (const reason of ["", " ", "\n\t"]) {
    const edge = asSystem(read, String(reason));
    expect(buildGraph([{ ...root, edges: [edge] }])).toEqual({
      _tag: "Invalid",
      reason: "Blank system reason at root",
    });
  }
});

it("dedupes each closure and never switches a system path back to person", () => {
  const middle = defineOperation("middle", {
    ...root,
    permission: "items:middle",
    edges: [read, write],
  });
  const app = defineOperation("app", {
    ...root,
    permission: "items:feature",
    edges: [read, asSystem(middle, "background")],
  });
  expect(permissionClosures(app)).toEqual({
    person: ["items:feature", "items:read"],
    system: ["items:middle", "items:read", "items:write"],
  });
  expect(permissionClosures(app, "system")).toEqual({
    person: [],
    system: ["items:feature", "items:read", "items:middle", "items:write"],
  });
  expect(buildGraph([app])._tag).toBe("Valid");
});

it("terminates closure walking even for a forged cyclic graph", () => {
  const edges: AnyCallable[] = [];
  const cyclic: AnyCallable = { ...read, edges };
  edges.push(cyclic);
  expect(permissionClosures(cyclic)).toEqual({ person: ["items:read"], system: [] });
});
