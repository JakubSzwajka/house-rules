import {
  type AnyCallable,
  type Edge,
  NoInput,
  asSystem,
  defineOperation,
} from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
import { endpoint } from "../contract/endpoint.ts";
import {
  type AnyEntryPoint,
  defineFeature,
  defineReadModel,
  systemStart,
} from "../feature/feature.ts";
import { bindOperation } from "../runtime/binding.ts";
import { validateRuntime } from "../runtime/runtime.ts";
import { type AnyWay, validateWays } from "./way-validation.ts";
import { mapRegistry } from "../registry/app-map.ts";
import type { AppMapSnapshot } from "../registry/app-map-snapshot.ts";
import { type Entry, planIssues, targetName } from "../registry/plan-checks.ts";
import { type Plan, PlanInvalid, type PlanIssue } from "../registry/plan.ts";
import type { RegistrySnapshot, RegistryWay } from "../registry/registry.ts";

const stub = {
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
} as const;

const build = (
  entries: ReadonlyMap<string, Entry>,
): Readonly<{ built: Map<string, AnyCallable>; cycle?: PlanIssue }> => {
  const built = new Map<string, AnyCallable>();
  const active = new Set<string>();
  const visit = (name: string): PlanIssue | undefined => {
    const entry = entries.get(name);
    if (entry === undefined || built.has(name)) return;
    // Frozen descriptors cannot form a cycle, so a cycle can only be found while building.
    if (active.has(name)) return { path: entry.path, reason: `Cycle at ${name}` };
    active.add(name);
    const edges: Edge[] = [];
    for (const edge of entry.value.edges ?? []) {
      const issue = visit(targetName(edge));
      if (issue !== undefined) return issue;
      const target = built.get(targetName(edge));
      if (target === undefined) continue;
      edges.push(typeof edge === "string" ? target : asSystem(target, edge.reason));
    }
    active.delete(name);
    const { value } = entry;
    const flags = {
      readOnly: value.readOnly ?? false,
      destructive: value.destructive ?? false,
      transactional: value.transactional ?? false,
      needsApproval: value.needsApproval ?? false,
    };
    const entryOptions = {
      ...stub,
      description: name,
      permission: value.permission,
      edges: edges as readonly (AnyCallable & { readonly kind?: "operation" })[],
      flags,
      start:
        entry.kind === "operation" ||
        entry.value.start === undefined ||
        entry.value.start === "person"
          ? ("person" as const)
          : systemStart(entry.value.start.reason, entry.value.start.startedBy),
      handler: () => Effect.void,
    };
    built.set(
      name,
      entry.kind === "operation"
        ? defineOperation(name, {
            ...stub,
            description: name,
            permission: value.permission,
            edges,
            ...flags,
          })
        : entry.value.kind === "read-model"
          ? defineReadModel(name, {
              ...entryOptions,
              edges: edges as readonly (AnyCallable & {
                readonly kind?: "operation";
                readonly readOnly: true;
              })[],
              flags: { ...flags, readOnly: true, destructive: false },
            })
          : defineFeature(name, entryOptions),
    );
  };
  for (const name of entries.keys()) {
    const cycle = visit(name);
    if (cycle !== undefined) return { built, cycle };
  }
  return { built };
};

type Derived =
  | Readonly<{ _tag: "Invalid"; issues: readonly PlanIssue[] }>
  | Readonly<{ _tag: "Valid"; snapshot: AppMapSnapshot }>;
const failed = (issues: readonly PlanIssue[]): Derived => ({ _tag: "Invalid", issues });

const derive = (plan: Plan): Derived => {
  const { issues, entries } = planIssues(plan);
  if (issues.length > 0) return failed(issues);
  const { built, cycle } = build(entries);
  if (cycle !== undefined) return failed([cycle]);
  const operation = (name: string) =>
    built.get(name) as RegistrySnapshot["mounts"][number]["operations"][number];
  const feature = (name: string) => built.get(name) as AnyEntryPoint;
  const features = plan.features.map((each) => feature(each.name));
  const ways = plan.ways.map(
    (way): RegistryWay => ({
      name: way.name,
      ...(way.mean === undefined ? {} : { mean: way.mean }),
      ...(way.protocol === "hook"
        ? { protocol: way.protocol, slot: way.slot }
        : way.protocol === "schedule"
          ? { protocol: way.protocol, clock: way.clock }
          : way.protocol === "event"
            ? { protocol: way.protocol, on: way.on }
            : { protocol: way.protocol, path: way.path }),
      features: way.features.map(feature),
      ...(way.protocol === "http" && way.public !== undefined
        ? { public: way.public.map(feature) }
        : {}),
    }),
  );
  const invalid =
    validateRuntime({
      bindings: plan.modules.flatMap((module) =>
        module.operations.map((each) => bindOperation(operation(each.name), () => Effect.void)),
      ),
      features,
      ways,
    }) ?? validateNetworkWays(features, ways);
  if (invalid !== undefined) return failed([{ path: "plan", reason: invalid }]);
  const snapshot = mapRegistry({
    mounts: plan.modules.map((module) => ({
      service: module.service,
      map: {
        name: module.name,
        kind: module.kind,
        role: module.role ?? "capability",
        ...(module.package === undefined ? {} : { package: module.package }),
      },
      operations: module.operations.map((each) => operation(each.name)),
    })),
    features,
    ways,
    ...(plan.plugs === undefined ? {} : { plugs: plan.plugs }),
  });
  // Modules match by unique service: two mounts may share a display name.
  const source = <A, P extends Partial<Record<K, string>>, K extends string>(
    values: readonly A[],
    plans: readonly P[],
    same: (value: A, each: P) => boolean,
    key: K,
  ): A[] =>
    values.map((value) => {
      const fact = plans.find((each) => same(value, each))?.[key];
      return fact === undefined ? value : { ...value, [key]: fact };
    });
  const byName = (value: { readonly name: string }, each: { readonly name: string }) =>
    value.name === each.name;
  return {
    _tag: "Valid",
    snapshot: {
      ...snapshot,
      modules: source(
        snapshot.modules,
        plan.modules,
        (value, each) => value.service === each.service,
        "path",
      ),
      features: source(snapshot.features, plan.features, byName, "path"),
      ways: source(snapshot.ways, plan.ways, byName, "source"),
    },
  };
};

const validateNetworkWays = (
  features: readonly AnyEntryPoint[],
  ways: readonly RegistryWay[],
): string | undefined => {
  // One counter across ways: prefixes "" and "/" both glue to "", so per-way indexes collided.
  let stubs = 0;
  try {
    return validateWays(
      features,
      ways.map(
        (way) =>
          ({
            ...way,
            ...(way.protocol === "http"
              ? // Plans place no endpoints; "~" never occurs in a way prefix, so unique stubs cannot collide.
                { endpoints: way.features.map((each) => endpoint(each, `POST /~${stubs++}`)) }
              : {}),
            ...(way.protocol === "mcp"
              ? {
                  tools: way.features.map((each) => ({
                    feature: each,
                    title: each.name,
                    idempotent: false,
                    openWorld: false,
                  })),
                  resource: { paths: [] },
                }
              : {}),
          }) as unknown as AnyWay,
      ),
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid way";
  }
};

export const validatePlan = (plan: Plan): Effect.Effect<AppMapSnapshot, PlanInvalid> =>
  Effect.suspend(() => {
    // Routes, sessions, CORS, slot providers and cron parsing need the real app and pnpm check.
    const result = derive(plan);
    return result._tag === "Valid"
      ? Effect.succeed(result.snapshot)
      : Effect.fail(
          new PlanInvalid({
            reason: `Plan has ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}; first: ${result.issues[0]?.reason ?? ""}`,
            issues: result.issues,
          }),
        );
  });
