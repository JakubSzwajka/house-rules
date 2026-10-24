import type { Plan, PlanEdge, PlanFeature, PlanIssue, PlanOperation } from "./plan.ts";
import { mergePlugs } from "./plugs.ts";

type PlanEdgeValue = typeof PlanEdge.Type;
export type Entry =
  | Readonly<{
      kind: "operation";
      path: string;
      module: Plan["modules"][number];
      value: typeof PlanOperation.Type;
    }>
  | Readonly<{ kind: "feature"; path: string; value: typeof PlanFeature.Type }>;

export const targetName = (edge: PlanEdgeValue): string =>
  typeof edge === "string" ? edge : edge.target;

export const planIssues = (
  plan: Plan,
): Readonly<{ issues: PlanIssue[]; entries: Map<string, Entry> }> => {
  const issues: PlanIssue[] = [];
  const entries = new Map<string, Entry>();
  // Every original entry, duplicates included, so a duplicate's own issues are still reported.
  const all: Entry[] = [];
  const services = new Map<string, string>();
  const add = (entry: Entry): void => {
    all.push(entry);
    const seen = entries.get(entry.value.name);
    if (seen === undefined) entries.set(entry.value.name, entry);
    else
      issues.push({
        path: `${entry.path}.name`,
        reason: `Duplicate callable name ${entry.value.name} (also ${seen.path})`,
      });
  };
  for (const [m, module] of plan.modules.entries()) {
    const seen = services.get(module.service);
    if (seen === undefined) services.set(module.service, `modules[${m}]`);
    else
      issues.push({
        path: `modules[${m}].service`,
        reason: `Duplicate mount service ${module.service} (also ${seen})`,
      });
    for (const [o, value] of module.operations.entries())
      add({ kind: "operation", path: `modules[${m}].operations[${o}]`, module, value });
  }
  for (const [f, value] of plan.features.entries())
    add({ kind: "feature", path: `features[${f}]`, value });
  for (const entry of all) {
    const { start } = entry.value as { start?: typeof PlanFeature.Type.start };
    if (typeof start === "object" && (start.reason.trim() === "" || start.startedBy.trim() === ""))
      issues.push({
        path: `${entry.path}.start`,
        reason: `Blank system feature reason or startedBy at ${entry.value.name}`,
      });
    for (const [e, edge] of (entry.value.edges ?? []).entries()) {
      const target = entries.get(targetName(edge));
      if (target?.kind === "feature")
        issues.push({
          path: `${entry.path}.edges[${e}]`,
          reason: `Edge must target an operation: ${entry.value.name} -> ${target.value.name}`,
        });
      if (
        entry.kind === "operation" &&
        (entry.module.role ?? "capability") === "capability" &&
        target?.kind === "operation" &&
        target.module.role === "process"
      )
        issues.push({
          path: `${entry.path}.edges[${e}]`,
          reason: `Capability module ${entry.module.name} cannot call process module ${target.module.name}: ${entry.value.name} → ${target.value.name}`,
        });
      if (target === undefined)
        issues.push({
          path: `${entry.path}.edges[${e}]`,
          reason: `Unresolved edge target ${targetName(edge)} at ${entry.value.name}`,
        });
      if (typeof edge !== "string" && edge.reason.trim() === "")
        issues.push({
          path: `${entry.path}.edges[${e}].reason`,
          reason: `Blank system reason at ${entry.value.name}`,
        });
    }
  }
  const ways = new Map<string, string>();
  for (const [w, way] of plan.ways.entries()) {
    const seen = ways.get(way.name);
    if (seen === undefined) ways.set(way.name, `ways[${w}]`);
    else
      issues.push({
        path: `ways[${w}].name`,
        reason: `Duplicate way name ${way.name} (also ${seen})`,
      });
    for (const [k, name] of way.features.entries())
      if (entries.get(name)?.kind !== "feature")
        issues.push({
          path: `ways[${w}].features[${k}]`,
          reason: `${way.name} exposes ${name}, which is not a plan feature`,
        });
    if (!("public" in way) || way.public === undefined) continue;
    if (way.protocol === "mcp")
      issues.push({ path: `ways[${w}].public`, reason: "MCP ways cannot expose public features" });
    for (const [k, name] of way.public.entries()) {
      const entry = entries.get(name);
      if (!way.features.includes(name))
        issues.push({
          path: `ways[${w}].public[${k}]`,
          reason: `Public feature ${name} must be exposed by ${way.name}`,
        });
      else if (entry?.kind === "feature" && (entry.value.start ?? "person") === "person")
        issues.push({
          path: `ways[${w}].public[${k}]`,
          reason: `Public feature ${name} must declare a system start`,
        });
    }
  }
  issues.push(...mergePlugs(plan.ways, plan.plugs ?? []).issues);
  return { issues, entries };
};
