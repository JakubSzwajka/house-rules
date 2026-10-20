import { type AnyNode, buildGraph, targetOf } from "@house-rules/domain/contract";
import type { AnyEntry } from "../entry/entry.ts";

export const renderRegistry = (
  data: Readonly<{
    nodes: readonly AnyNode[];
    entries: readonly AnyEntry[];
    ways: readonly Readonly<{ name: string; path: string; entries: readonly AnyEntry[] }>[];
  }>,
): string => {
  const result = buildGraph(data.nodes);
  const nodes = result._tag === "Valid" ? result.graph.nodes : data.nodes;
  const lines = [
    "# Registry",
    "",
    ...(result._tag === "Invalid" ? [`Invalid graph: ${result.reason}`, ""] : []),
    "## Nodes",
    "",
  ];
  for (const node of [...nodes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const callers = nodes
      .filter((candidate) => candidate.edges.some((edge) => targetOf(edge) === node))
      .map((caller) => caller.name)
      .sort();
    lines.push(
      `### ${node.name}`,
      "",
      `- Permission: ${node.permission ?? "none"}`,
      `- Called by: ${callers.join(", ") || "none"}`,
    );
    for (const edge of node.edges)
      lines.push(
        "target" in edge
          ? `- Calls: ⚙ ${edge.target.name} (system: ${edge.reason})`
          : `- Calls: ${edge.name} (person, inherited system stays system)`,
      );
    lines.push("");
  }
  lines.push("## Entries", "");
  for (const entry of data.entries) {
    const ways = data.ways
      .filter((way) => way.entries.includes(entry))
      .map((way) => `${way.name} (${way.path})`);
    lines.push(
      `### ${entry.node.name}`,
      "",
      `- Starts as: ${entry.start === "person" ? "person" : `system: ${entry.start.reason}; ${entry.start.startedBy}`}`,
      `- Person closure: ${entry.closures.person.join(", ") || "none"}`,
      `- System closure: ${entry.closures.system.join(", ") || "none"}`,
      `- Exposed by: ${ways.join(", ") || "in-process only"}`,
      "",
    );
  }
  return lines.join("\n");
};
