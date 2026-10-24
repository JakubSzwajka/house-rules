import type { AppMapSnapshot } from "./app-map-snapshot.ts";
import { moduleGroups, moduleOwner } from "./app-map-modules.ts";

export const mermaid = (data: AppMapSnapshot): string => {
  const lines = ["flowchart LR"];
  const nodes = [
    ...data.ways.map((way) => `way:${way.name}`),
    ...data.features.map((feature) => feature.name),
    ...data.modules.flatMap((module) => module.operations.map((operation) => operation.name)),
  ];
  const id = (name: string): string => `n${nodes.indexOf(name)}`;
  const escape = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\n", " ");
  for (const name of nodes.filter(
    (name) => name.startsWith("way:") || data.features.some((feature) => feature.name === name),
  ))
    lines.push(`  ${id(name)}["${escape(name)}"]`);
  for (const [groupIndex, group] of moduleGroups(data).entries()) {
    if (group.modules.length === 0) continue;
    lines.push(`  subgraph g${groupIndex}["${group.title}"]`);
    for (const module of group.modules) {
      const index = data.modules.indexOf(module);
      lines.push(
        `    subgraph m${index}["${escape(`${module.name} (${module.kind}, ${moduleOwner(module)})`)}"]`,
      );
      for (const operation of module.operations)
        lines.push(`      ${id(operation.name)}["${escape(operation.name)}"]`);
      lines.push("    end");
    }
    lines.push("  end");
  }
  for (const way of data.ways)
    for (const feature of way.features) lines.push(`  ${id(`way:${way.name}`)} --> ${id(feature)}`);
  for (const callable of [...data.features, ...data.modules.flatMap((module) => module.operations)])
    for (const edge of callable.edges)
      lines.push(
        `  ${id(callable.name)} -->${edge.reason === undefined ? "" : `|"⚙ ${escape(edge.reason)}"|`} ${id(edge.target)}`,
      );
  return `${lines.join("\n")}\n`;
};
