import { type AnyCallable, targetOf } from "@house-rules/domain/contract";
import type { RegistrySnapshot } from "./registry.ts";
import { mergePlugs } from "./plugs.ts";
import { mermaid } from "./app-map-mermaid.ts";
import { canonical, compare, named, strings } from "./app-map-order.ts";
import { appMapHtml } from "./app-map-html.ts";
import { moduleGroups, moduleOwner } from "./app-map-modules.ts";

import type { AppMapSnapshot, MapEdge } from "./app-map-snapshot.ts";

export type {
  AppMapSnapshot,
  MapEdge,
  MapOperation,
  MapModule,
  MapPlug,
} from "./app-map-snapshot.ts";

const meanNames = { allow: "allow", no: "deny approval", elicitation: "ask the human" } as const;

const edges = (callable: AnyCallable): MapEdge[] =>
  callable.edges
    .map(
      (edge): MapEdge => ({
        target: targetOf(edge).name,
        kind: "operation",
        ...("target" in edge ? { reason: edge.reason } : {}),
      }),
    )
    .sort((a, b) => compare(a.target, b.target) || compare(a.reason ?? "", b.reason ?? ""));

export const mapRegistry = (data: RegistrySnapshot): AppMapSnapshot => {
  const operations = data.mounts.flatMap((mount) => mount.operations);
  return {
    layers:
      "ways-in → entry points (feature / read-model) → operations → modules / projections; composition wires (fixed header, not extracted from layout)",
    modules: named(
      data.mounts.map((mount) => ({
        name:
          mount.map?.name ??
          (mount.service.split("/").at(-1) ?? mount.service)
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .toLowerCase(),
        service: mount.service,
        kind: mount.map?.kind ?? ("package" as const),
        role: mount.map?.role ?? ("capability" as const),
        ...(mount.map?.package === undefined ? {} : { package: mount.map.package }),
        operations: named(
          mount.operations.map((operation) => ({
            name: operation.name,
            permission: operation.permission,
            readOnly: operation.readOnly,
            destructive: operation.destructive,
            transactional: operation.transactional,
            needsApproval: operation.needsApproval,
            edges: edges(operation),
          })),
        ),
      })),
    ),
    features: named(
      data.features.map((feature) => ({
        name: feature.name,
        kind: feature.kind,
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
        ...(way.mean === undefined ? {} : { mean: meanNames[way.mean] }),
        ...(way.protocol === "hook"
          ? { slot: way.slot }
          : way.protocol === "schedule"
            ? { clock: { cron: way.clock.cron, timeZone: way.clock.timeZone } }
            : way.protocol === "event"
              ? { on: strings(way.on) }
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
    // Issues were checked first: appMap fails on them and validatePlan reports them.
    plugs: mergePlugs(data.ways, data.plugs ?? []).plugs,
  };
};

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
  // Way features and in-process features share one form, closures included.
  const featureLines = (
    feature: AppMapSnapshot["features"][number],
    branch: string,
    trunk: string,
  ): string[] => [
    ...wrap(
      branch,
      `${feature.name} [${feature.kind ?? "feature"}]  ${feature.start === "person" ? "person" : `system (${feature.start.reason})`}${feature.path === undefined ? "" : `  ${feature.path}`}  needs ${feature.closures.person.join(" ") || "none"}${feature.closures.system.length === 0 ? "" : `; system needs ${feature.closures.system.join(" ")}`}`,
      trunk,
    ),
    ...feature.edges.flatMap((edge, edgeIndex) => {
      const children = operations.find((operation) => operation.name === edge.target)?.edges ?? [];
      const lastEdge = edgeIndex === feature.edges.length - 1;
      return wrap(
        `${trunk}${lastEdge ? "└─" : "├─"} `,
        `${edgeText(edge)}${children.length === 0 ? "" : ` → ${children.map(edgeText).join(", ")}`}`,
        `${trunk}${lastEdge ? "   " : "│  "}`,
      );
    }),
  ];
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
    if (way.on !== undefined) lines.push(...wrap("  on: ", way.on.join(", ")));
    if (way.mean !== undefined) lines.push(...wrap("  Mean: ", way.mean));
    if (way.public.length > 0) lines.push(...wrap("  public: ", way.public.join(", ")));
    for (const [featureIndex, name] of way.features.entries()) {
      const feature = data.features.find((entry) => entry.name === name);
      if (feature === undefined) continue;
      const lastFeature = featureIndex === way.features.length - 1;
      lines.push(
        ...featureLines(
          feature,
          `  ${lastFeature ? "└─" : "├─"} `,
          lastFeature ? "      " : "  │   ",
        ),
      );
    }
  }
  const hidden = data.features.filter((feature) => feature.ways.length === 0);
  if (hidden.length > 0) {
    lines.push("", "IN-PROCESS FEATURES");
    for (const feature of hidden) lines.push(...featureLines(feature, " ", "  "));
  }
  for (const group of moduleGroups(data)) {
    if (group.title === "Process modules" && group.modules.length === 0) continue;
    lines.push("", group.title.toUpperCase());
    for (const module of group.modules) {
      const names = new Set(module.operations.map((operation) => operation.name));
      const callers = named([...data.features, ...operations])
        .filter((callable) => callable.edges.some((edge) => names.has(edge.target)))
        .map((callable) => callable.name);
      lines.push(
        ...wrap(
          " ",
          `${module.name}  ${module.kind} [${moduleOwner(module)}]${module.package === undefined ? "" : ` ${module.package}`}${module.path === undefined ? "" : `  ${module.path}`}`,
        ),
        ...wrap("  ops: ", module.operations.map((operation) => operation.name).join(" ")),
        ...module.operations.flatMap((operation) =>
          operation.edges.length === 0
            ? []
            : wrap(`  ${operation.name} → `, operation.edges.map(edgeText).join(", ")),
        ),
        ...wrap("  called by: ", callers.join(" ") || "none"),
      );
    }
  }
  if (data.plugs !== undefined && data.plugs.length > 0) {
    lines.push("", "PLUGS");
    for (const plug of data.plugs)
      lines.push(
        ...wrap(
          " ",
          `${plug.name}  fills ${plug.fills}${plug.ways === undefined || plug.ways.length === 0 ? "" : ` on ${plug.ways.join(", ")}`}${plug.package === undefined ? "" : `  ${plug.package}`}`,
        ),
      );
  }
  lines.push("", "PERMISSIONS");
  for (const permission of data.permissions)
    lines.push(
      ...wrap(` ${permission.name} ← `, permission.operations.join(", ") || "feature only"),
    );
  return `${lines.join("\n")}\n`;
};

export const renderMap = (
  snapshot: AppMapSnapshot,
  format: "text" | "json" | "mermaid" | "html",
): string => {
  const data = canonical(snapshot);
  if (format === "html") return appMapHtml(data);
  return format === "json"
    ? `${JSON.stringify(data, null, 2)}\n`
    : format === "mermaid"
      ? mermaid(data)
      : text(data);
};
