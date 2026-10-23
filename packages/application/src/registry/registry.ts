import { type AnyCallable, buildGraph, targetOf } from "@house-rules/domain/contract";
import { type AnyFeature, isFeature } from "../feature/feature.ts";
import { permissionCatalogue } from "./permission-catalogue.ts";
type Operation = AnyCallable & { readonly kind: "operation" };
export type MountMap = Readonly<{ name: string; kind: "package" | "read-model"; package?: string }>;

export type RegistryWay = Readonly<{
  name: string;
  features: readonly AnyFeature[];
  public?: readonly AnyFeature[];
  meanName?: string;
}> &
  (
    | Readonly<{ protocol: "http" | "mcp"; path: string }>
    | Readonly<{ protocol: "hook"; slot: string }>
    | Readonly<{ protocol: "schedule"; clock: Readonly<{ cron: string; timeZone: string }> }>
  );
export interface RegistrySnapshot {
  readonly mounts: readonly Readonly<{
    service: string;
    map?: MountMap;
    operations: readonly Operation[];
  }>[];
  readonly features: readonly AnyFeature[];
  readonly ways: readonly RegistryWay[];
}

const address = (way: RegistryWay): string =>
  way.protocol === "hook"
    ? `hook: ${way.slot}`
    : way.protocol === "schedule"
      ? `schedule: ${way.clock.cron} ${way.clock.timeZone}`
      : `${way.protocol}: ${way.path}`;

const calls = (callable: AnyCallable): string[] =>
  callable.edges.map((edge) =>
    "target" in edge
      ? `- Calls: ⚙ ${edge.target.name} (system: ${edge.reason})`
      : `- Calls: ${edge.name} (person, inherited system stays system)`,
  );

export const renderRegistry = (data: RegistrySnapshot): string => {
  const roots = [...data.mounts.flatMap((mount) => mount.operations), ...data.features];
  const result = buildGraph(roots);
  const callables = result._tag === "Valid" ? result.graph.callables : roots;
  const lines = [
    "# Registry",
    "",
    ...(result._tag === "Invalid" ? [`Invalid graph: ${result.reason}`, ""] : []),
    "## Mounts",
    "",
    ...[...data.mounts]
      .sort((a, b) => a.service.localeCompare(b.service))
      .map(
        (mount) =>
          `- ${mount.service}: ${
            mount.operations
              .map((operation) => operation.name)
              .sort()
              .join(", ") || "none"
          }`,
      ),
    "",
    "## Ways",
    "",
    ...[...data.ways]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (way) =>
          `- ${way.name} (${address(way)}): ${
            way.features
              .map((feature) => feature.name)
              .sort()
              .join(", ") || "none"
          }`,
      ),
    "",
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
  for (const feature of [...data.features].sort((a, b) => a.name.localeCompare(b.name))) {
    const ways = data.ways
      .filter((way) => way.features.includes(feature))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((way) => `${way.name} (${address(way)})`);
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
