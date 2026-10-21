import {
  type AnyCallable,
  type Callable,
  type CallableFailureSchema,
  type Closures,
  type Edge,
  type InputSchema,
  type KindedError,
  type Permission,
  type PlainSchema,
  type SystemCaller,
  type Targets,
  buildGraph,
  permissionClosures,
} from "@house-rules/domain/contract";
import type { Effect } from "effect";
import type { CallScope, InnerFailure } from "./call-scope.ts";

const featureBrand: unique symbol = Symbol("@house-rules/application/Feature");
const definedFeatures = new WeakSet<AnyCallable>();

type Reachable<C extends AnyCallable, Seen = never> = C extends Seen
  ? never
  : AnyCallable extends C
    ? AnyCallable
    : C | Reachable<Targets<C>, Seen | C>;
type AnyFlag<B extends boolean> = true extends B ? true : false;
type AllFlag<B extends boolean> = false extends B ? false : true;
export type FeatureFlags<C extends AnyCallable> = Readonly<{
  readOnly: AllFlag<Reachable<C>["readOnly"]>;
  destructive: AnyFlag<Reachable<C>["destructive"]>;
  transactional: AnyFlag<Reachable<C>["transactional"]>;
  needsApproval: AnyFlag<Reachable<C>["needsApproval"]>;
}>;
export type Feature<C extends AnyCallable, Start extends "person" | SystemCaller = "person"> = Omit<
  C,
  keyof FeatureFlags<C> | "kind" | "flags" | "handler" | "start" | "closures"
> &
  FeatureFlags<C> &
  Readonly<{
    [featureBrand]: true;
    kind: "feature";
    flags: Readonly<Pick<C, "readOnly" | "destructive" | "transactional" | "needsApproval">>;
    start: Start;
    closures: Closures;
    handler: (
      input: C["input"]["Type"],
      scope: CallScope<C>,
    ) => Effect.Effect<C["output"]["Type"], C["failure"]["Type"] | InnerFailure>;
  }>;
export type AnyFeature = AnyCallable &
  Readonly<{
    [featureBrand]: true;
    kind: "feature";
    flags: Readonly<
      Pick<AnyCallable, "readOnly" | "destructive" | "transactional" | "needsApproval">
    >;
    start: "person" | SystemCaller;
    closures: Closures;
    handler: (...args: never[]) => Effect.Effect<unknown, KindedError>;
  }>;

export const systemStart = <const Reason extends string>(
  reason: Reason & (Reason extends "" ? never : unknown),
  startedBy: string = reason,
): SystemCaller => Object.freeze({ kind: "system", reason, startedBy });

export const defineFeature = <
  const Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends CallableFailureSchema,
  const Edges extends readonly Edge[] = readonly [],
  const RO extends boolean = false,
  const D extends boolean = false,
  const T extends boolean = false,
  const A extends boolean = false,
  const Start extends "person" | SystemCaller = "person",
>(
  name: Name,
  options: Readonly<{
    description: string;
    title?: string;
    permission: Permission | null;
    input: I;
    output: O;
    failure: F;
    edges?: Edges;
    flags?: Readonly<{ readOnly?: RO; destructive?: D; transactional?: T; needsApproval?: A }>;
    start?: Start;
    handler: (
      input: NoInfer<I["Type"]>,
      scope: CallScope<Callable<Name, I, O, F, NoInfer<Edges>, RO, D, T, A>>,
    ) => Effect.Effect<NoInfer<O["Type"]>, NoInfer<F["Type"]> | InnerFailure>;
  }>,
): Feature<
  Callable<Name, I, O, F, NoInfer<Edges>, NoInfer<RO>, NoInfer<D>, NoInfer<T>, NoInfer<A>>,
  Start
> => {
  const own = {
    ...options,
    name,
    edges: Object.freeze([...(options.edges ?? [])]),
    readOnly: options.flags?.readOnly ?? false,
    destructive: options.flags?.destructive ?? false,
    transactional: options.flags?.transactional ?? false,
    needsApproval: options.flags?.needsApproval ?? false,
  };
  const result = buildGraph([own]);
  const callables = result._tag === "Valid" ? result.graph.callables : [own];
  const requestedStart: "person" | SystemCaller = options.start ?? "person";
  const start = requestedStart === "person" ? "person" : Object.freeze({ ...requestedStart });
  const closures = permissionClosures(own, start === "person" ? "person" : "system");
  const feature = Object.freeze({
    ...own,
    [featureBrand]: true,
    kind: "feature",
    flags: Object.freeze({
      readOnly: own.readOnly,
      destructive: own.destructive,
      transactional: own.transactional,
      needsApproval: own.needsApproval,
    }),
    start,
    closures: Object.freeze({
      person: Object.freeze([...closures.person]),
      system: Object.freeze([...closures.system]),
    }),
    readOnly: callables.every((each) => each.readOnly),
    destructive: callables.some((each) => each.destructive),
    transactional: callables.some((each) => each.transactional),
    needsApproval: callables.some((each) => each.needsApproval),
  }) as unknown as Feature<Callable<Name, I, O, F, Edges, RO, D, T, A>, Start>;
  definedFeatures.add(feature);
  return feature;
};

export const isFeature = (callable: AnyCallable): callable is AnyFeature =>
  definedFeatures.has(callable);
