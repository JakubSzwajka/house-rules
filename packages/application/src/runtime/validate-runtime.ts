import { type AnyCallable, buildGraph, permissionClosures, targetOf } from "@house-rules/domain";
import { type AnyEntryPoint, isEntryPoint } from "../feature/feature.ts";
import type { Binding } from "./binding.ts";

export type BindingOptions = Readonly<{
  bindings: readonly Binding[];
  features: readonly AnyEntryPoint[];
  ways: readonly Readonly<{
    name: string;
    features: readonly AnyEntryPoint[];
    protocol?: "http" | "mcp" | "hook" | "schedule" | "event";
    public?: readonly AnyEntryPoint[];
  }>[];
}>;

export const validateRuntime = (options: BindingOptions): string | undefined => {
  const graph = buildGraph([
    ...options.bindings.map((binding) => binding.callable),
    ...options.features,
  ]);
  if (graph._tag === "Invalid") return graph.reason;
  if (options.bindings.some((binding) => isEntryPoint(binding.callable)))
    return "Entry points cannot have operation bindings";
  const bound = new Set<AnyCallable>(options.bindings.map((binding) => binding.callable));
  if (bound.size !== options.bindings.length) return "A callable has more than one binding";
  for (const callable of graph.graph.callables) {
    for (const edge of callable.edges) {
      const target = targetOf(edge);
      if ("kind" in target && (target.kind === "feature" || target.kind === "read-model"))
        return `Edge must target an operation: ${callable.name} -> ${target.name}`;
    }
    if (
      "kind" in callable &&
      (callable.kind === "feature" || callable.kind === "read-model") &&
      !isEntryPoint(callable)
    )
      return `Feature was not created by defineFeature: ${callable.name}`;
    if (!isEntryPoint(callable) && !bound.has(callable))
      return `Operation has no binding: ${callable.name}`;
    if (!isEntryPoint(callable)) continue;
    if (callable.kind === "read-model" && (!callable.flags.readOnly || callable.destructive))
      return `Invalid read-model flags at ${callable.name}`;
    if (
      callable.start !== "person" &&
      (callable.start.reason.trim() === "" || callable.start.startedBy.trim() === "")
    )
      return `Blank system feature reason or startedBy at ${callable.name}`;
    const closures = permissionClosures(
      callable,
      callable.start === "person" ? "person" : "system",
    );
    for (const mode of ["person", "system"] as const) {
      const supplied = callable.closures[mode];
      if (
        supplied.length !== closures[mode].length ||
        closures[mode].some((permission) => !supplied.includes(permission))
      )
        return `Invalid ${mode} closure at ${callable.name}`;
    }
    const reachable = new Set<AnyCallable>();
    const visit = (current: AnyCallable): void => {
      if (reachable.has(current)) return;
      reachable.add(current);
      for (const edge of current.edges) visit(targetOf(edge));
    };
    visit(callable);
    if (callable.kind === "read-model") {
      const write = [...reachable].find(
        (target) => target !== callable && target.readOnly !== true,
      );
      if (write !== undefined) return `Read-only ${callable.name} reaches write ${write.name}`;
    }
    const flags = [...reachable].map((current) =>
      isEntryPoint(current) ? current.flags : current,
    );
    if (
      callable.readOnly !== flags.every((own) => own.readOnly) ||
      callable.destructive !== flags.some((own) => own.destructive) ||
      callable.transactional !== flags.some((own) => own.transactional) ||
      callable.needsApproval !== flags.some((own) => own.needsApproval)
    )
      return `Invalid lifted flags at ${callable.name}`;
  }
  const registered = new Set(options.features);
  if (registered.size !== options.features.length) return "A feature is registered twice";
  for (const feature of options.features) {
    const name = feature.name;
    if (!isEntryPoint(feature)) return `Feature was not created by defineFeature: ${name}`;
  }
  for (const way of options.ways) {
    if (
      (way.protocol === "hook" || way.protocol === "schedule" || way.protocol === "event") &&
      way.features.some((feature) => feature.start === "person")
    )
      return "System ways require system-start features";
    if (way.protocol === "mcp" && way.public !== undefined)
      return "MCP ways cannot expose public features";
    for (const feature of way.public ?? []) {
      if (!way.features.includes(feature)) return "Public features must be exposed by the way";
      if (feature.start === "person") return "Public features must declare a system start";
    }
    if (
      new Set(way.features).size !== way.features.length ||
      new Set(way.features.map((feature) => feature)).size !== way.features.length
    )
      return `${way.name} exposes an feature twice`;
    for (const feature of way.features)
      if (!registered.has(feature))
        return `${way.name} exposes an unregistered feature ${feature.name}`;
  }
};
