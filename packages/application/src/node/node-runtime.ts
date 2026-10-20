import {
  type AnyNode,
  type Caller,
  type KindedError,
  buildGraph,
  targetOf,
} from "@house-rules/domain";
import { Context, Effect, Exit, Layer } from "effect";
import { CurrentActor } from "../actor/current-actor.ts";
import { CallRequestId } from "../call/call-facts.ts";
import { CallerContext } from "../caller/caller-context.ts";
import type { AnyEntry } from "../entry/entry.ts";
import { Forbidden } from "../gates/gate-errors.ts";
import { CallPermissions, entryAndRecheck } from "../socket/permission-lists.ts";
import { StepTrace } from "../trace/step-trace.ts";
import type { Binding, InnerFailure, ScopedCall } from "./binding.ts";
import { GraphInvalid } from "./graph-invalid.ts";
import { NodeCallInvalid } from "./node-call-invalid.ts";

export type NodeRuntimeOptions = Readonly<{
  bindings: readonly Binding[];
  entries: readonly AnyEntry[];
  ways: readonly Readonly<{ name: string; entries: readonly AnyEntry[] }>[];
}>;

export const validateRuntime = (options: NodeRuntimeOptions): string | undefined => {
  const graph = buildGraph([
    ...options.bindings.map((binding) => binding.node),
    ...options.entries.map((entry) => entry.node),
  ]);
  if (graph._tag === "Invalid") return graph.reason;
  const bound = new Set(options.bindings.map((binding) => binding.node));
  if (bound.size !== options.bindings.length) return "A node has more than one binding";
  for (const node of graph.graph.nodes)
    if (!bound.has(node)) return `Node has no binding: ${node.name}`;
  const registered = new Set(options.entries);
  if (registered.size !== options.entries.length) return "An entry is registered twice";
  for (const entry of options.entries) {
    if (entry.start !== "person" && entry.start.reason.trim() === "")
      return `Blank system entry reason at ${entry.node.name}`;
  }
  for (const way of options.ways) {
    if (
      new Set(way.entries).size !== way.entries.length ||
      new Set(way.entries.map((entry) => entry.node)).size !== way.entries.length
    )
      return `${way.name} exposes an entry twice`;
    for (const entry of way.entries)
      if (!registered.has(entry))
        return `${way.name} exposes an unregistered entry ${entry.node.name}`;
  }
};

export class NodeRuntime extends Context.Service<
  NodeRuntime,
  {
    run: <N extends AnyNode>(
      node: N,
      input: N["input"]["Type"],
      caller: Caller,
      entryName: string,
    ) => Effect.Effect<
      N["output"]["Type"],
      N["failure"]["Type"] | InnerFailure,
      CallPermissions | StepTrace
    >;
  }
>()("@house-rules/application/NodeRuntime") {
  static readonly make = (
    options: NodeRuntimeOptions,
  ): Effect.Effect<NodeRuntime["Service"], GraphInvalid> =>
    Effect.gen(function* () {
      const invalid = validateRuntime(options);
      if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
      const implementations = new Map(options.bindings.map((binding) => [binding.node, binding]));
      const run = Effect.fnUntraced(function* (
        node: AnyNode,
        input: unknown,
        caller: Caller,
        entryName: string,
      ): Effect.fn.Return<unknown, KindedError, CallPermissions | StepTrace> {
        const implementation = implementations.get(node);
        if (implementation === undefined)
          return yield* new NodeCallInvalid({ node: node.name, reason: "Node has no binding" });
        const permissions = yield* CallPermissions;
        const trace = yield* StepTrace;
        const requestId = yield* CallRequestId;
        const call = (target: AnyNode, targetInput: unknown) =>
          Effect.gen(function* () {
            const edge = node.edges.find((candidate) => targetOf(candidate) === target);
            if (edge === undefined)
              return yield* new NodeCallInvalid({
                node: target.name,
                reason: `Undeclared edge from ${node.name}`,
              });
            const next: Caller =
              caller.kind === "system"
                ? caller
                : "target" in edge
                  ? {
                      kind: "system",
                      reason: edge.reason,
                      startedBy: `${entryName} · ${caller.actor.id}`,
                    }
                  : caller;
            const order = yield* trace.begin(requestId, {
              entry: entryName,
              target: target.name,
              caller: next.kind,
              reason: next.kind === "system" ? next.reason : null,
            });
            const work = Effect.gen(function* () {
              const held = next.kind === "system" ? permissions.system : permissions.person;
              if (
                (permissions.gatePolicy ?? entryAndRecheck) === entryAndRecheck &&
                target.permission !== null &&
                !held.includes(target.permission)
              ) {
                return yield* new Forbidden({
                  entry: entryName,
                  permission: target.permission,
                  caller: next.kind,
                });
              }
              return yield* run(target, targetInput, next, entryName);
            });
            return yield* work.pipe(
              Effect.onExit((exit) =>
                trace.finish(requestId, order, Exit.isSuccess(exit) ? "success" : "failure"),
              ),
            );
          });
        const work = implementation
          .run(input, { caller, call: call as ScopedCall<AnyNode> })
          .pipe(Effect.provideService(CallerContext, caller));
        return yield* caller.kind === "person"
          ? work.pipe(Effect.provideService(CurrentActor, caller.actor))
          : work.pipe(Effect.updateContext<never, never>(Context.omit(CurrentActor)));
      });
      const service = { run: run as NodeRuntime["Service"]["run"] };
      runtimeOptions.set(service, options);
      return service;
    });
  static readonly layer = (options: NodeRuntimeOptions): Layer.Layer<NodeRuntime, GraphInvalid> =>
    Layer.effect(NodeRuntime, NodeRuntime.make(options));
}

const runtimeOptions = new WeakMap<NodeRuntime["Service"], NodeRuntimeOptions>();
export const validateExposures = (
  runtime: NodeRuntime["Service"],
  entries: readonly AnyEntry[],
  ways: NodeRuntimeOptions["ways"],
): string | undefined => {
  const options = runtimeOptions.get(runtime);
  return options === undefined
    ? "NodeRuntime was not acquired through NodeRuntime.make/layer"
    : validateRuntime({ bindings: options.bindings, entries, ways });
};
