import { type AnyCallable, targetOf } from "@house-rules/domain/contract";
import { isFeature } from "../feature/feature.ts";
import type { RegistrySnapshot } from "./registry.ts";

import type { AppMapSnapshot, MapEdge } from "./app-map-snapshot.ts";

export type { AppMapSnapshot, MapEdge, MapOperation, MapModule } from "./app-map-snapshot.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const named = <A extends { readonly name: string }>(values: readonly A[]): A[] =>
  [...values].sort((a, b) => compare(a.name, b.name));
const strings = (values: readonly string[]): string[] => [...values].sort(compare);
const edges = (callable: AnyCallable): MapEdge[] =>
  callable.edges
    .map(
      (edge): MapEdge => ({
        target: targetOf(edge).name,
        kind: isFeature(targetOf(edge)) ? "feature" : "operation",
        ...("target" in edge ? { reason: edge.reason } : {}),
      }),
    )
    .sort((a, b) => compare(a.target, b.target) || compare(a.reason ?? "", b.reason ?? ""));

export const mapRegistry = (data: RegistrySnapshot): AppMapSnapshot => {
  const operations = data.mounts.flatMap((mount) => mount.operations);
  return {
    layers:
      "ways-in → features → operations → modules / read models; composition wires (fixed header, not extracted from layout)",
    modules: named(
      data.mounts.map((mount) => ({
        name:
          mount.map?.name ??
          (mount.service.split("/").at(-1) ?? mount.service)
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .toLowerCase(),
        service: mount.service,
        kind: mount.map?.kind ?? ("package" as const),
        ...(mount.map?.package === undefined ? {} : { package: mount.map.package }),
        operations: named(
          mount.operations.map((operation) => ({
            name: operation.name,
            permission: operation.permission,
            readOnly: operation.readOnly,
            destructive: operation.destructive,
            edges: edges(operation),
          })),
        ),
      })),
    ),
    features: named(
      data.features.map((feature) => ({
        name: feature.name,
        start:
          feature.start === "person"
            ? ("person" as const)
            : {
                kind: "system" as const,
                reason: feature.start.reason,
                startedBy: feature.start.startedBy,
              },
        permission: feature.permission,
        flags: {
          readOnly: feature.readOnly,
          destructive: feature.destructive,
          transactional: feature.transactional,
          needsApproval: feature.needsApproval,
        },
        closures: {
          person: strings(feature.closures.person),
          system: strings(feature.closures.system),
        },
        edges: edges(feature),
        ways: strings(
          data.ways.filter((way) => way.features.includes(feature)).map((way) => way.name),
        ),
      })),
    ),
    ways: named(
      data.ways.map((way) => ({
        name: way.name,
        protocol: way.protocol,
        ...(way.meanName === undefined ? {} : { mean: way.meanName }),
        ...(way.protocol === "hook"
          ? { slot: way.slot }
          : way.protocol === "schedule"
            ? { clock: { cron: way.clock.cron, timeZone: way.clock.timeZone } }
            : { path: way.path }),
        features: strings(way.features.map((feature) => feature.name)),
        public: strings((way.public ?? []).map((feature) => feature.name)),
      })),
    ),
    permissions: strings([
      ...new Set(
        operations.flatMap((callable) =>
          callable.permission === null ? [] : [callable.permission],
        ),
      ),
    ]).map((name) => ({
      name,
      operations: strings(
        operations
          .filter((operation) => operation.permission === name)
          .map((operation) => operation.name),
      ),
    })),
  };
};

const canonical = (data: AppMapSnapshot): AppMapSnapshot => ({
  layers: data.layers,
  modules: named(data.modules).map((module) => ({
    ...module,
    operations: named(module.operations).map((operation) => ({
      ...operation,
      edges: sortEdges(operation.edges),
    })),
  })),
  features: named(data.features).map((feature) => ({
    ...feature,
    closures: {
      person: strings(feature.closures.person),
      system: strings(feature.closures.system),
    },
    edges: sortEdges(feature.edges),
    ways: strings(feature.ways),
  })),
  ways: named(data.ways).map((way) => ({
    ...way,
    features: strings(way.features),
    public: strings(way.public),
  })),
  permissions: named(data.permissions).map((permission) => ({
    ...permission,
    operations: strings(permission.operations),
  })),
});
const sortEdges = (values: readonly MapEdge[]): MapEdge[] =>
  [...values].sort(
    (a, b) => compare(a.target, b.target) || compare(a.reason ?? "", b.reason ?? ""),
  );
const edgeText = (edge: MapEdge): string =>
  `${edge.reason === undefined ? "" : "⚙ "}${edge.target}${edge.reason === undefined ? "" : ` (${edge.reason})`}`;

const wrap = (
  prefix: string,
  value: string,
  continuation = " ".repeat(prefix.length),
): string[] => {
  const lines: string[] = [];
  let line = prefix + value;
  while (line.length > 100) {
    const boundary = line.lastIndexOf(" ", 100);
    // Keep identifiers intact, even when one identifier exceeds the target width.
    if (boundary <= continuation.length) break;
    lines.push(line.slice(0, boundary).trimEnd());
    line = continuation + line.slice(boundary + 1).trimStart();
  }
  lines.push(line);
  return lines;
};

const text = (data: AppMapSnapshot): string => {
  const lines = [...wrap("LAYERS   ", data.layers), "", "WAYS"];
  const operations = data.modules.flatMap((module) => module.operations);
  for (const way of data.ways) {
    const address =
      way.slot === undefined
        ? way.clock === undefined
          ? way.path
          : `${way.clock.cron} ${way.clock.timeZone}`
        : `slot ${way.slot}`;
    lines.push(
      ...wrap(
        " ",
        `${way.name}  ${way.protocol} ${address ?? ""}  [${way.features.length} features]${way.source === undefined ? "" : `  ${way.source}`}`,
      ),
    );
    if (way.mean !== undefined) lines.push(...wrap("  Mean: ", way.mean));
    if (way.public.length > 0) lines.push(...wrap("  public: ", way.public.join(", ")));
    for (const [featureIndex, name] of way.features.entries()) {
      const feature = data.features.find((entry) => entry.name === name);
      if (feature === undefined) continue;
      const lastFeature = featureIndex === way.features.length - 1;
      const trunk = lastFeature ? "      " : "  │   ";
      lines.push(
        ...wrap(
          `  ${lastFeature ? "└─" : "├─"} `,
          `${name}  ${feature.start === "person" ? "person" : `system (${feature.start.reason})`}${feature.path === undefined ? "" : `  ${feature.path}`}  needs ${feature.closures.person.join(" ") || "none"}${feature.closures.system.length === 0 ? "" : `; system needs ${feature.closures.system.join(" ")}`}`,
          trunk,
        ),
      );
      for (const [edgeIndex, edge] of feature.edges.entries()) {
        const children =
          operations.find((operation) => operation.name === edge.target)?.edges ?? [];
        const lastEdge = edgeIndex === feature.edges.length - 1;
        lines.push(
          ...wrap(
            `${trunk}${lastEdge ? "└─" : "├─"} `,
            `${edgeText(edge)}${children.length === 0 ? "" : ` → ${children.map(edgeText).join(", ")}`}`,
            `${trunk}${lastEdge ? "   " : "│  "}`,
          ),
        );
      }
    }
  }
  const hidden = data.features.filter((feature) => feature.ways.length === 0);
  if (hidden.length > 0) {
    lines.push("", "IN-PROCESS FEATURES");
    for (const feature of hidden)
      lines.push(
        ...wrap(
          " ",
          `${feature.name}  ${feature.path ?? ""} → ${feature.edges.map(edgeText).join(", ")}`,
        ),
      );
  }
  for (const kind of ["package", "read-model"] as const) {
    lines.push("", kind === "package" ? "MODULES" : "READ MODELS");
    for (const module of data.modules.filter((entry) => entry.kind === kind)) {
      const names = new Set(module.operations.map((operation) => operation.name));
      const callers = data.features
        .filter((feature) => feature.edges.some((edge) => names.has(edge.target)))
        .map((feature) => feature.name);
      lines.push(
        ...wrap(
          " ",
          `${module.name}  ${kind}${module.package === undefined ? "" : ` ${module.package}`}${module.path === undefined ? "" : `  ${module.path}`}`,
        ),
        ...wrap("  ops: ", module.operations.map((operation) => operation.name).join(" ")),
        ...wrap("  called by: ", callers.join(" ") || "none"),
      );
    }
  }
  lines.push("", "PERMISSIONS");
  for (const permission of data.permissions)
    lines.push(
      ...wrap(` ${permission.name} ← `, permission.operations.join(", ") || "feature only"),
    );
  return `${lines.join("\n")}\n`;
};

const mermaid = (data: AppMapSnapshot): string => {
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

export const renderMap = (
  snapshot: AppMapSnapshot,
  format: "text" | "json" | "mermaid",
): string => {
  const data = canonical(snapshot);
  return format === "json"
    ? `${JSON.stringify(data, null, 2)}\n`
    : format === "mermaid"
      ? mermaid(data)
      : text(data);
};
