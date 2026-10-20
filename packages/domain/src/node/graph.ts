import type { Permission } from "../policy/permission.ts";
import { type AnyNode, targetOf } from "./node.ts";

export type Graph = Readonly<{ nodes: readonly AnyNode[] }>;
export type GraphResult =
  | Readonly<{ _tag: "Valid"; graph: Graph }>
  | Readonly<{ _tag: "Invalid"; reason: string }>;
export type Closures = Readonly<{
  person: readonly Permission[];
  system: readonly Permission[];
}>;

export const buildGraph = (roots: readonly AnyNode[]): GraphResult => {
  const visited = new Set<AnyNode>();
  const active = new Set<AnyNode>();
  const names = new Map<string, AnyNode>();
  const visit = (node: AnyNode): string | undefined => {
    if (active.has(node)) return `Cycle at ${node.name}`;
    if (visited.has(node)) return;
    if (names.has(node.name) && names.get(node.name) !== node)
      return `Duplicate node name ${node.name}`;
    names.set(node.name, node);
    active.add(node);
    const targets = new Set<AnyNode>();
    for (const edge of node.edges) {
      const target = targetOf(edge);
      if (targets.has(target)) return `Repeated target ${target.name} at ${node.name}`;
      targets.add(target);
      if ("target" in edge && edge.reason.trim() === "")
        return `Blank system reason at ${node.name}`;
      if (node.readOnly && !target.readOnly)
        return `Read-only ${node.name} calls write ${target.name}`;
      const invalid = visit(target);
      if (invalid !== undefined) return invalid;
    }
    active.delete(node);
    visited.add(node);
  };
  for (const root of roots) {
    const invalid = visit(root);
    if (invalid !== undefined) return { _tag: "Invalid", reason: invalid };
  }
  return { _tag: "Valid", graph: { nodes: [...visited] } };
};

export const permissionClosures = (
  node: AnyNode,
  startsAs: "person" | "system" = "person",
): Closures => {
  const person = new Set<Permission>();
  const system = new Set<Permission>();
  const visited = new Map<AnyNode, Set<"person" | "system">>();
  const visit = (current: AnyNode, mode: "person" | "system"): void => {
    const modes = visited.get(current) ?? new Set<"person" | "system">();
    if (modes.has(mode)) return;
    modes.add(mode);
    visited.set(current, modes);
    if (current.permission !== null) (mode === "person" ? person : system).add(current.permission);
    for (const edge of current.edges)
      visit(targetOf(edge), mode === "system" || "target" in edge ? "system" : "person");
  };
  visit(node, startsAs);
  return { person: [...person], system: [...system] };
};
