import type { Permission } from "../policy/permission.ts";
import { type AnyCallable, targetOf } from "./operation.ts";

export type Graph = Readonly<{ callables: readonly AnyCallable[] }>;
export type GraphResult =
  | Readonly<{ _tag: "Valid"; graph: Graph }>
  | Readonly<{ _tag: "Invalid"; reason: string }>;
export type Closures = Readonly<{
  person: readonly Permission[];
  system: readonly Permission[];
}>;

export const buildGraph = (roots: readonly AnyCallable[]): GraphResult => {
  const visited = new Set<AnyCallable>();
  const active = new Set<AnyCallable>();
  const names = new Map<string, AnyCallable>();
  const visit = (callable: AnyCallable): string | undefined => {
    if (active.has(callable)) return `Cycle at ${callable.name}`;
    if (visited.has(callable)) return;
    if (names.has(callable.name) && names.get(callable.name) !== callable)
      return `Duplicate callable name ${callable.name}`;
    names.set(callable.name, callable);
    active.add(callable);
    const targets = new Set<AnyCallable>();
    for (const edge of callable.edges) {
      const target = targetOf(edge);
      if (targets.has(target)) return `Repeated target ${target.name} at ${callable.name}`;
      targets.add(target);
      if ("target" in edge && edge.reason.trim() === "")
        return `Blank system reason at ${callable.name}`;
      if ((callable.flags?.readOnly ?? callable.readOnly) && !target.readOnly)
        return `Read-only ${callable.name} calls write ${target.name}`;
      const invalid = visit(target);
      if (invalid !== undefined) return invalid;
    }
    active.delete(callable);
    visited.add(callable);
  };
  for (const root of roots) {
    const invalid = visit(root);
    if (invalid !== undefined) return { _tag: "Invalid", reason: invalid };
  }
  return { _tag: "Valid", graph: { callables: [...visited] } };
};

export const permissionClosures = (
  callable: AnyCallable,
  startsAs: "person" | "system" = "person",
): Closures => {
  const person = new Set<Permission>();
  const system = new Set<Permission>();
  const visited = new Map<AnyCallable, Set<"person" | "system">>();
  const visit = (current: AnyCallable, mode: "person" | "system"): void => {
    const modes = visited.get(current) ?? new Set<"person" | "system">();
    if (modes.has(mode)) return;
    modes.add(mode);
    visited.set(current, modes);
    if (current.permission !== null) (mode === "person" ? person : system).add(current.permission);
    for (const edge of current.edges)
      visit(targetOf(edge), mode === "system" || "target" in edge ? "system" : "person");
  };
  visit(callable, startsAs);
  return { person: [...person], system: [...system] };
};
