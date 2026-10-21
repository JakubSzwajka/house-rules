import { type AnyCallable, buildGraph, targetOf } from "@house-rules/domain/contract";
import { type AnyFeature, isFeature } from "../feature/feature.ts";
import { permissionCatalogue } from "./permission-catalogue.ts";

const calls = (callable: AnyCallable): string[] =>
  callable.edges.map((edge) =>
    "target" in edge
      ? `- Calls: ⚙ ${edge.target.name} (system: ${edge.reason})`
      : `- Calls: ${edge.name} (person, inherited system stays system)`,
  );

export const renderRegistry = (
  data: Readonly<{
    operations: readonly AnyCallable[];
    features: readonly AnyFeature[];
    ways: readonly Readonly<{ name: string; path: string; features: readonly AnyFeature[] }>[];
  }>,
): string => {
  const roots = [...data.operations, ...data.features];
  const result = buildGraph(roots);
  const callables = result._tag === "Valid" ? result.graph.callables : roots;
  const lines = [
    "# Registry",
    "",
    ...(result._tag === "Invalid" ? [`Invalid graph: ${result.reason}`, ""] : []),
    "## Permissions",
    "",
    ...permissionCatalogue(callables).map((permission) => `- ${permission}`),
    "",
    "## Operations",
    "",
  ];
  for (const callable of callables
    .filter((each) => !isFeature(each))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const callers = callables
      .filter((candidate) => candidate.edges.some((edge) => targetOf(edge) === callable))
      .map((caller) => caller.name)
      .sort();
    lines.push(
      `### ${callable.name}`,
      "",
      `- Permission: ${callable.permission ?? "none"}`,
      `- Called by: ${callers.join(", ") || "none"}`,
    );
    lines.push(...calls(callable));
    lines.push("");
  }
  lines.push("## Features", "");
  for (const feature of data.features) {
    const ways = data.ways
      .filter((way) => way.features.includes(feature))
      .map((way) => `${way.name} (${way.path})`);
    lines.push(
      `### ${feature.name}`,
      "",
      `- Starts as: ${feature.start === "person" ? "person" : `system: ${feature.start.reason}; ${feature.start.startedBy}`}`,
      `- Person closure: ${feature.closures.person.join(", ") || "none"}`,
      `- System closure: ${feature.closures.system.join(", ") || "none"}`,
      `- Exposed by: ${ways.join(", ") || "in-process only"}`,
      ...calls(feature),
      "",
    );
  }
  return lines.join("\n");
};
