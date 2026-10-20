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
export type NodeFailureSchema = PlainSchema & { readonly Type: KindedError };

export type SystemEdge<N extends AnyNode = AnyNode, Reason extends string = string> = Readonly<{
  target: N;
  mode: "system";
  reason: Reason;
}>;
export type Edge = AnyNode | SystemEdge;
export type Target<E extends Edge> = E extends SystemEdge<infer N> ? N : E;
export type Targets<N extends AnyNode> = Target<N["edges"][number]>;
export type Node<
  Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends NodeFailureSchema,
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
}>;
export type AnyNode = Node<
  string,
  InputSchema,
  PlainSchema,
  NodeFailureSchema,
  readonly Edge[],
  boolean,
  boolean,
  boolean,
  boolean
>;

export const defineNode = <
  const Name extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends NodeFailureSchema,
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
    readOnly?: RO;
    destructive?: D;
    transactional?: T;
    needsApproval?: A;
  }>,
): Node<Name, I, O, F, NoInfer<Edges>, NoInfer<RO>, NoInfer<D>, NoInfer<T>, NoInfer<A>> =>
  Object.freeze({
    ...options,
    name,
    edges: Object.freeze([...(options.edges ?? [])]) as unknown as Edges,
    readOnly: (options.readOnly ?? false) as RO,
    destructive: (options.destructive ?? false) as D,
    transactional: (options.transactional ?? false) as T,
    needsApproval: (options.needsApproval ?? false) as A,
  });

export const asSystem = <N extends AnyNode, const Reason extends string>(
  target: N,
  reason: Reason & (Reason extends "" ? never : unknown),
): SystemEdge<N, Reason> => Object.freeze({ target, mode: "system", reason });

export const targetOf = <E extends Edge>(edge: E): Target<E> =>
  ("target" in edge ? edge.target : edge) as Target<E>;
