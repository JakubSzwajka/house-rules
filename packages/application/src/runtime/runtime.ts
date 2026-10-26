import {
  type AnyCallable,
  type Caller,
  type KindedError,
  type Permission,
  buildGraph,
  targetOf,
} from "@house-rules/domain";
import { Context, Effect, Exit, Layer, Option } from "effect";
import { type BindingOptions, validateRuntime } from "./validate-runtime.ts";
export { validateRuntime } from "./validate-runtime.ts";
import { PermissionCatalogue } from "../registry/catalogue.ts";
import { CurrentActor } from "../actor/current-actor.ts";
import { CallRequestId } from "../call/call-facts.ts";
import { EventCausation } from "../call/event-causation.ts";
import { CallerContext } from "../caller/caller-context.ts";
import { type AnyEntryPoint, isEntryPoint } from "../feature/feature.ts";
import { Forbidden } from "../gates/gate-errors.ts";
import { CallPermissions } from "../socket/permission-lists.ts";
import { StepTrace } from "../trace/step-trace.ts";
import type { Binding, InnerFailure, ScopedCall } from "./binding.ts";
import { GraphInvalid } from "./graph-invalid.ts";
import { CallInvalid } from "./call-invalid.ts";
import { permissionCatalogue } from "../registry/permission-catalogue.ts";
import {
  type CheckedMounts,
  type MountDefinition,
  type Services,
  validateMounts,
} from "./mount.ts";

export type RuntimeOptions<
  M extends readonly MountDefinition<any, any>[] = readonly MountDefinition<any, any>[],
> = Readonly<{
  mounts: M & CheckedMounts<M>;
  features: readonly AnyEntryPoint[];
  ways: BindingOptions["ways"];
}>;

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
    options: BindingOptions,
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
        const implementation = isEntryPoint(callable)
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
        const causedBy = yield* EventCausation;
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
              ...(causedBy === undefined ? {} : { causedBy }),
            });
            const work = Effect.gen(function* () {
              const held = next.kind === "system" ? permissions.system : permissions.person;
              if (target.permission !== null && !held.includes(target.permission)) {
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
  static readonly layer = <const M extends readonly MountDefinition<any, any>[]>(
    options: RuntimeOptions<M>,
  ): Layer.Layer<Runtime, GraphInvalid, Services<M>> =>
    Layer.effect(
      Runtime,
      Effect.gen(function* () {
        const invalid = validateMounts(options.mounts);
        if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
        const bindings: Binding[] = [];
        for (const mount of options.mounts) {
          const service = yield* Effect.serviceOption(
            mount.service as Context.Key<Services<M>, unknown>,
          );
          if (Option.isNone(service))
            return yield* new GraphInvalid({
              reason: `Mount service was not provided: ${mount.service.key}`,
            });
          const own = mount.bind(service.value);
          const bound = new Set(own.map((binding) => binding.callable));
          if (
            bound.size !== own.length ||
            bound.size !== mount.operations.length ||
            own.some((binding) => !mount.operations.includes(binding.callable)) ||
            mount.operations.some((operation) => !bound.has(operation))
          )
            return yield* new GraphInvalid({
              reason: `Binder must bind exactly the descriptors of ${mount.service.key}`,
            });
          bindings.push(...own);
        }
        const runtime = yield* Runtime.make({ ...options, bindings });
        const catalogue = yield* Effect.serviceOption(PermissionCatalogue);
        if (Option.isSome(catalogue)) {
          const service = { ...runtime, permissions: yield* catalogue.value.permissions() };
          runtimeOptions.set(service, { ...options, bindings });
          return service;
        }
        return runtime;
      }),
    ) as Layer.Layer<Runtime, GraphInvalid, Services<M>>;
}

const runtimeOptions = new WeakMap<Runtime["Service"], BindingOptions>();
export const validateExposures = (
  runtime: Runtime["Service"],
  features: readonly AnyEntryPoint[],
  ways: BindingOptions["ways"],
): string | undefined => {
  const options = runtimeOptions.get(runtime);
  return options === undefined
    ? "Runtime was not acquired through Runtime.make/layer"
    : validateRuntime({ bindings: options.bindings, features: features, ways });
};
