import type { NodeRef, Relation, RelationDirection } from "./relation.js";
export const nodeKey = (node: NodeRef): string => JSON.stringify([node.kind, node.id]);
export const sameNode = (a: NodeRef, b: NodeRef): boolean => a.kind === b.kind && a.id === b.id;
export const compareNodes = (a: NodeRef, b: NodeRef): number =>
  a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const touches = (edge: Relation, node: NodeRef, direction: RelationDirection): boolean =>
  (direction !== "in" && sameNode(edge.source, node)) ||
  (direction !== "out" && sameNode(edge.target, node));
export const neighbours = (
  edge: Relation,
  node: NodeRef,
  direction: RelationDirection,
): ReadonlyArray<NodeRef> => [
  ...(direction !== "in" && sameNode(edge.source, node) ? [edge.target] : []),
  ...(direction !== "out" && sameNode(edge.target, node) ? [edge.source] : []),
];
export const copyRelation = (edge: Relation): Relation => ({
  ...edge,
  source: { ...edge.source },
  target: { ...edge.target },
});
export const compareRelations = (a: Relation, b: Relation): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
