import {
  type AnyCallable,
  type Callable,
  type CallableFailureSchema,
  type Closures,
  type InputSchema,
  type KindedError,
  type Permission,
  type PlainSchema,
  type SystemCaller,
  type SystemEdge,
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
export type EntryPointKind = "feature" | "read-model";
export type EntryPoint<
  C extends AnyCallable,
  Start extends "person" | SystemCaller = "person",
  Kind extends EntryPointKind = EntryPointKind,
> = Omit<C, keyof FeatureFlags<C> | "kind" | "flags" | "handler" | "start" | "closures"> &
  FeatureFlags<C> &
  Readonly<{
    [featureBrand]: true;
    kind: Kind;
    flags: Readonly<Pick<C, "readOnly" | "destructive" | "transactional" | "needsApproval">>;
    start: Start;
    closures: Closures;
    handler: (
      input: C["input"]["Type"],
      scope: CallScope<C>,
    ) => Effect.Effect<C["output"]["Type"], C["failure"]["Type"] | InnerFailure>;
  }>;
export type Feature<
  C extends AnyCallable,
  Start extends "person" | SystemCaller = "person",
> = EntryPoint<C, Start, "feature">;
export type ReadModel<
  C extends AnyCallable,
  Start extends "person" | SystemCaller = "person",
> = EntryPoint<C, Start, "read-model">;
export type AnyFeature = AnyEntryPoint & { readonly kind: "feature" };
export type AnyReadModel = AnyEntryPoint & { readonly kind: "read-model" };
export type AnyEntryPoint = AnyCallable &
  Readonly<{
    [featureBrand]: true;
    kind: EntryPointKind;
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

type OperationTarget<Kind extends EntryPointKind> = AnyCallable & {
  readonly kind?: "operation";
} & (Kind extends "read-model" ? { readonly readOnly: true } : unknown);
type OperationEdge<Kind extends EntryPointKind> =
  | OperationTarget<Kind>
  | SystemEdge<OperationTarget<Kind>>;

const entryPointBuilder =
  <Kind extends EntryPointKind>(kind: Kind) =>
  <
    const Name extends string,
    I extends InputSchema,
    O extends PlainSchema,
    F extends CallableFailureSchema,
    const Edges extends readonly OperationEdge<Kind>[] = readonly [],
    const RO extends boolean = Kind extends "read-model" ? true : false,
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
      flags?: Readonly<{
        readOnly?: Kind extends "read-model" ? true : RO;
        destructive?: Kind extends "read-model" ? false : D;
        transactional?: T;
        needsApproval?: A;
      }>;
      start?: Start;
      handler: (
        input: NoInfer<I["Type"]>,
        scope: CallScope<Callable<Name, I, O, F, NoInfer<Edges>, RO, D, T, A>>,
      ) => Effect.Effect<NoInfer<O["Type"]>, NoInfer<F["Type"]> | InnerFailure>;
    }>,
  ): EntryPoint<
    Callable<Name, I, O, F, NoInfer<Edges>, NoInfer<RO>, NoInfer<D>, NoInfer<T>, NoInfer<A>>,
    Start,
    Kind
  > => {
    const own = {
      ...options,
      name,
      edges: Object.freeze([...(options.edges ?? [])]),
      readOnly: kind === "read-model" || (options.flags?.readOnly ?? false),
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
      kind,
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
    }) as unknown as EntryPoint<Callable<Name, I, O, F, Edges, RO, D, T, A>, Start, Kind>;
    definedFeatures.add(feature);
    return feature;
  };

export const defineFeature = entryPointBuilder("feature");
export const defineReadModel = entryPointBuilder("read-model");
export const isEntryPoint = (callable: AnyCallable): callable is AnyEntryPoint =>
  definedFeatures.has(callable);
export const isFeature = (callable: AnyCallable): callable is AnyFeature =>
  isEntryPoint(callable) && callable.kind === "feature";
