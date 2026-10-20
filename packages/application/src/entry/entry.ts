import {
  type AnyNode,
  type Closures,
  type SystemCaller,
  type Targets,
  buildGraph,
  permissionClosures,
} from "@house-rules/domain/contract";

type Reachable<N extends AnyNode, Seen = never> = N extends Seen
  ? never
  : AnyNode extends N
    ? AnyNode
    : N | Reachable<Targets<N>, Seen | N>;
type AnyFlag<B extends boolean> = true extends B ? true : false;
type AllFlag<B extends boolean> = false extends B ? false : true;
export type EntryFlags<N extends AnyNode> = Readonly<{
  readOnly: AllFlag<Reachable<N>["readOnly"]>;
  destructive: AnyFlag<Reachable<N>["destructive"]>;
  transactional: AnyFlag<Reachable<N>["transactional"]>;
  needsApproval: AnyFlag<Reachable<N>["needsApproval"]>;
}>;
export type Entry<N extends AnyNode, Start extends "person" | SystemCaller = "person"> = Readonly<{
  node: N;
  start: Start;
  closures: Closures;
}> &
  EntryFlags<N>;
export type AnyEntry = Readonly<{
  node: AnyNode;
  start: "person" | SystemCaller;
  closures: Closures;
  readOnly: boolean;
  destructive: boolean;
  transactional: boolean;
  needsApproval: boolean;
}>;

export function defineEntry<N extends AnyNode>(node: N): Entry<N, "person">;
export function defineEntry<N extends AnyNode, const S extends SystemCaller>(
  node: N,
  options: Readonly<{ start: S }>,
): Entry<N, S>;
export function defineEntry(node: AnyNode, options?: Readonly<{ start: SystemCaller }>): AnyEntry {
  const result = buildGraph([node]);
  const nodes = result._tag === "Valid" ? result.graph.nodes : [node];
  return Object.freeze({
    node,
    start: options?.start ?? "person",
    closures: permissionClosures(node, options === undefined ? "person" : "system"),
    readOnly: nodes.every((each) => each.readOnly),
    destructive: nodes.some((each) => each.destructive),
    transactional: nodes.some((each) => each.transactional),
    needsApproval: nodes.some((each) => each.needsApproval),
  });
}
