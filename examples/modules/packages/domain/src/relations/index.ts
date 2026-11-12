import { Edge } from "./edge.aggregate.ts";
import { NodeEdges } from "./node-edges.view.ts";

export { Edge } from "./edge.aggregate.ts";
export { EdgeId, edgeId, NodeId } from "./edge.id.ts";
export { Link, NodeEdges } from "./node-edges.view.ts";
export { RelationsPermissions } from "./permissions.ts";
export { EdgeIdMismatch, Relate, EdgeRelated } from "./relate.command.ts";
export { Unrelate, EdgeUnrelated } from "./unrelate.command.ts";

export const aggregates = [Edge] as const;
export const views = [NodeEdges] as const;
