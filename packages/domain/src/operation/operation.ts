import { Schema } from "effect";
import type { KindedError } from "../error/error-kind.ts";
import type { Permission } from "../policy/permission.ts";

export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};
export type StructInput = Schema.Struct<Readonly<Record<string, PlainSchema>>>;
export type UnionInput = Schema.Union<readonly StructInput[]>;
export const NoInput = Schema.Record(Schema.String, Schema.Never);
export type NoInput = typeof NoInput;
export type InputSchema = StructInput | UnionInput | NoInput;
export type CallableFailureSchema = PlainSchema & { readonly Type: KindedError };

export type SystemEdge<
  N extends AnyCallable = AnyCallable,
  Reason extends string = string,
> = Readonly<{
  target: N;
  mode: "system";
  reason: Reason;
}>;
export type Edge = AnyCallable | SystemEdge;
export type Target<E extends Edge> = E extends SystemEdge<infer N> ? N : E;
export type Targets<N extends AnyCallable> = Target<N["edges"][number]>;
export type Callable<
  Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends CallableFailureSchema,
  Edges extends readonly Edge[],
  RO extends boolean = false,
  D extends boolean = false,
  T extends boolean = false,
  A extends boolean = false,
> = Readonly<{
  name: Name;
  description: string;
  title?: string;
  input: I;
  output: O;
  failure: F;
  permission: Permission | null;
  edges: Edges;
  readOnly: RO;
  destructive: D;
  transactional: T;
  needsApproval: A;
  flags?: Readonly<{
    readOnly?: boolean;
    destructive?: boolean;
    transactional?: boolean;
    needsApproval?: boolean;
  }>;
}>;
export type Operation<
  Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends CallableFailureSchema,
  Edges extends readonly Edge[],
  RO extends boolean = false,
  D extends boolean = false,
  T extends boolean = false,
  A extends boolean = false,
> = Callable<Name, I, O, F, Edges, RO, D, T, A> &
  Readonly<{
    kind: "operation";
    flags?: Readonly<{ readOnly?: RO; destructive?: D; transactional?: T; needsApproval?: A }>;
  }>;
export type AnyCallable = Callable<
  string,
  InputSchema,
  PlainSchema,
  CallableFailureSchema,
  readonly Edge[],
  boolean,
  boolean,
  boolean,
  boolean
>;

export const defineOperation = <
  const Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends CallableFailureSchema,
  const Edges extends readonly Edge[] = readonly [],
  const RO extends boolean = false,
  const D extends boolean = false,
  const T extends boolean = false,
  const A extends boolean = false,
>(
  name: Name,
  options: Readonly<{
    description: string;
    title?: string;
    input: I;
    output: O;
    failure: F;
    permission: Permission | null;
    edges?: Edges;
    flags?: Readonly<{ readOnly?: RO; destructive?: D; transactional?: T; needsApproval?: A }>;
    readOnly?: RO;
    destructive?: D;
    transactional?: T;
    needsApproval?: A;
  }>,
): Operation<Name, I, O, F, NoInfer<Edges>, NoInfer<RO>, NoInfer<D>, NoInfer<T>, NoInfer<A>> =>
  Object.freeze({
    ...options,
    ...(options.flags === undefined
      ? {}
      : {
          flags: Object.freeze({
            readOnly: (options.readOnly ?? options.flags.readOnly ?? false) as RO,
            destructive: (options.destructive ?? options.flags.destructive ?? false) as D,
            transactional: (options.transactional ?? options.flags.transactional ?? false) as T,
            needsApproval: (options.needsApproval ?? options.flags.needsApproval ?? false) as A,
          }),
        }),
    kind: "operation",
    name,
    edges: Object.freeze([...(options.edges ?? [])]) as unknown as Edges,
    readOnly: (options.readOnly ?? options.flags?.readOnly ?? false) as RO,
    destructive: (options.destructive ?? options.flags?.destructive ?? false) as D,
    transactional: (options.transactional ?? options.flags?.transactional ?? false) as T,
    needsApproval: (options.needsApproval ?? options.flags?.needsApproval ?? false) as A,
  });

export const asSystem = <N extends AnyCallable, const Reason extends string>(
  target: N,
  reason: Reason & (Reason extends "" ? never : unknown),
): SystemEdge<N, Reason> => Object.freeze({ target, mode: "system", reason });

export const targetOf = <E extends Edge>(edge: E): Target<E> =>
  ("target" in edge ? edge.target : edge) as Target<E>;
