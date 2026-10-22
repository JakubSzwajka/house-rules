import {
  type AnyCallable,
  type Caller,
  type KindedError,
  type Permission,
  buildGraph,
  permissionClosures,
  targetOf,
} from "@house-rules/domain";
import { Context, Effect, Exit, Layer } from "effect";
import { CurrentActor } from "../actor/current-actor.ts";
import { CallRequestId } from "../call/call-facts.ts";
import { CallerContext } from "../caller/caller-context.ts";
import { type AnyFeature, isFeature } from "../feature/feature.ts";
import { Forbidden } from "../gates/gate-errors.ts";
import { CallPermissions, featureAndRecheck } from "../socket/permission-lists.ts";
import { StepTrace } from "../trace/step-trace.ts";
import type { Binding, InnerFailure, ScopedCall } from "./binding.ts";
import { GraphInvalid } from "./graph-invalid.ts";
import { CallInvalid } from "./call-invalid.ts";
import { permissionCatalogue } from "../registry/permission-catalogue.ts";

export type RuntimeOptions = Readonly<{
  bindings: readonly Binding[];
  features: readonly AnyFeature[];
  ways: readonly Readonly<{
    name: string;
    features: readonly AnyFeature[];
    protocol?: "http" | "mcp";
    public?: readonly AnyFeature[];
  }>[];
}>;

export const validateRuntime = (options: RuntimeOptions): string | undefined => {
  const graph = buildGraph([
    ...options.bindings.map((binding) => binding.callable),
    ...options.features,
  ]);
  if (graph._tag === "Invalid") return graph.reason;
  const bound = new Set<AnyCallable>(options.bindings.map((binding) => binding.callable));
  if (bound.size !== options.bindings.length) return "A callable has more than one binding";
  for (const callable of graph.graph.callables) {
    if ("kind" in callable && callable.kind === "feature" && !isFeature(callable))
      return `Feature was not created by defineFeature: ${callable.name}`;
    if (!isFeature(callable) && !bound.has(callable))
      return `Operation has no binding: ${callable.name}`;
    if (!isFeature(callable)) continue;
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
    const flags = [...reachable].map((current) => (isFeature(current) ? current.flags : current));
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
    if (!isFeature(feature)) return `Feature was not created by defineFeature: ${name}`;
  }
  for (const way of options.ways) {
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

export class Runtime extends Context.Service<
  Runtime,
  {
    readonly permissions: readonly Permission[];
    run: <N extends AnyCallable>(
      callable: N,
      input: N["input"]["Type"],
      caller: Caller,
      featureName: string,
    ) => Effect.Effect<
      N["output"]["Type"],
      N["failure"]["Type"] | InnerFailure,
      CallPermissions | StepTrace
    >;
  }
>()("@house-rules/application/Runtime") {
  static readonly make = (
    options: RuntimeOptions,
  ): Effect.Effect<Runtime["Service"], GraphInvalid> =>
    Effect.gen(function* () {
      const invalid = validateRuntime(options);
      if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
      const graph = buildGraph([
        ...options.features,
        ...options.bindings.map((binding) => binding.callable),
      ]);
      const registered = new Set(graph._tag === "Valid" ? graph.graph.callables : []);
      const implementations = new Map<AnyCallable, Binding>(
        options.bindings.map((binding) => [binding.callable, binding]),
      );
      const run = Effect.fnUntraced(function* (
        callable: AnyCallable,
        input: unknown,
        caller: Caller,
        featureName: string,
      ): Effect.fn.Return<unknown, KindedError, CallPermissions | StepTrace> {
        if (!registered.has(callable))
          return yield* new CallInvalid({
            callable: callable.name,
            reason: "Callable is not registered",
          });
        const implementation = isFeature(callable)
          ? { run: callable.handler as unknown as Binding["run"] }
          : implementations.get(callable);
        if (implementation === undefined)
          return yield* new CallInvalid({
            callable: callable.name,
            reason: "Callable has no binding",
          });
        const permissions = yield* CallPermissions;
        const trace = yield* StepTrace;
        const requestId = yield* CallRequestId;
        const call = (target: AnyCallable, targetInput: unknown) =>
          Effect.gen(function* () {
            const edge = callable.edges.find((candidate) => targetOf(candidate) === target);
            if (edge === undefined)
              return yield* new CallInvalid({
                callable: target.name,
                reason: `Undeclared edge from ${callable.name}`,
              });
            const next: Caller =
              caller.kind === "system"
                ? caller
                : "target" in edge
                  ? {
                      kind: "system",
                      reason: edge.reason,
                      startedBy: `${featureName} · ${caller.actor.id}`,
                    }
                  : caller;
            const order = yield* trace.begin(requestId, {
              feature: featureName,
              target: target.name,
              caller: next.kind,
              reason: next.kind === "system" ? next.reason : null,
            });
            const work = Effect.gen(function* () {
              const held = next.kind === "system" ? permissions.system : permissions.person;
              if (
                (permissions.gatePolicy ?? featureAndRecheck) === featureAndRecheck &&
                target.permission !== null &&
                !held.includes(target.permission)
              ) {
                return yield* new Forbidden({
                  feature: featureName,
                  permission: target.permission,
                  caller: next.kind,
                });
              }
              return yield* run(target, targetInput, next, featureName);
            });
            return yield* work.pipe(
              Effect.onExit((exit) =>
                trace.finish(requestId, order, Exit.isSuccess(exit) ? "success" : "failure"),
              ),
            );
          });
        const work = implementation
          .run(input, { caller, call: call as ScopedCall<AnyCallable> })
          .pipe(Effect.provideService(CallerContext, caller));
        return yield* caller.kind === "person"
          ? work.pipe(Effect.provideService(CurrentActor, caller.actor))
          : work.pipe(Effect.updateContext<never, never>(Context.omit(CurrentActor)));
      });
      const service = {
        permissions: permissionCatalogue([...registered]),
        run: run as Runtime["Service"]["run"],
      };
      runtimeOptions.set(service, options);
      return service;
    });
  static readonly layer = (options: RuntimeOptions): Layer.Layer<Runtime, GraphInvalid> =>
    Layer.effect(Runtime, Runtime.make(options));
}

const runtimeOptions = new WeakMap<Runtime["Service"], RuntimeOptions>();
export const validateExposures = (
  runtime: Runtime["Service"],
  features: readonly AnyFeature[],
  ways: RuntimeOptions["ways"],
): string | undefined => {
  const options = runtimeOptions.get(runtime);
  return options === undefined
    ? "Runtime was not acquired through Runtime.make/layer"
    : validateRuntime({ bindings: options.bindings, features: features, ways });
};
