import type { AppMapSnapshot } from "./app-map-snapshot.ts";

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
  for (const [index, module] of data.modules.entries()) {
    lines.push(`  subgraph m${index}["${escape(`${module.name} (${module.kind})`)}"]`);
    for (const operation of module.operations)
      lines.push(`    ${id(operation.name)}["${escape(operation.name)}"]`);
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
