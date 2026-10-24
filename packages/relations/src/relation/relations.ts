import { UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { RelationStore } from "../storage.js";
import { compareNodes, neighbours, nodeKey, sameNode } from "./graph.js";
import type { RelationsOptions } from "./options.js";
import {
  DuplicateRelation,
  GraphTooLarge,
  ListRelationsInput,
  NodeRef,
  type RelateInput,
  RelationCardinalityExceeded,
  RelationCycle,
  RelationEndpointInvalid,
  RelationNotFound,
  type Relation,
  RelationsInputInvalid,
  RelationTypeUnknown,
  SubgraphInput,
} from "./relation.js";
export const makeRelations = (store: RelationStore["Service"], options: RelationsOptions) => {
  const invalid = () => new RelationsInputInvalid();
  const decodeNode = (node: NodeRef) =>
    Schema.decodeEffect(
      Schema.Struct({
        kind: Schema.Literals(options.nodeKinds),
        id: NodeRef.fields.id,
      }),
    )(node).pipe(Effect.mapError(() => new RelationEndpointInvalid()));
  const getType = Effect.fn("Relations.type")(function* (name: string) {
    const type = options.relationTypes.find((type) => type.name === name);
    if (type === undefined) return yield* new RelationTypeUnknown();
    return type;
  });
  const checkCap = Effect.fn("Relations.cardinality")(function* (
    node: NodeRef,
    type: string,
    direction: "out" | "in" | "both",
    cap?: number,
  ) {
    if (cap !== undefined && (yield* store.count(node, type, direction)) >= cap)
      return yield* new RelationCardinalityExceeded();
  });
  return {
    relate: Effect.fn("Relations.relate")(function* (input: RelateInput) {
      yield* UnitOfWork.required;
      const type = yield* getType(input.type);
      let source = yield* decodeNode(input.source);
      let target = yield* decodeNode(input.target);
      const forward = type.source.includes(source.kind) && type.target.includes(target.kind);
      const reverse =
        !type.directed && type.source.includes(target.kind) && type.target.includes(source.kind);
      if (!forward && !reverse) return yield* new RelationEndpointInvalid();
      if (!type.directed && compareNodes(source, target) > 0) [source, target] = [target, source];
      yield* store.lock(type.name);
      if (type.unique && (yield* store.exists(source, target, type.name)))
        return yield* new DuplicateRelation();
      if (type.directed) {
        yield* checkCap(source, type.name, "out", type.maxOutPerSource);
        yield* checkCap(target, type.name, "in", type.maxInPerTarget);
      } else {
        yield* checkCap(source, type.name, "both", type.maxDegree);
        if (!sameNode(source, target)) yield* checkCap(target, type.name, "both", type.maxDegree);
      }
      if (type.acyclic) {
        const reached = yield* store.reachable(target, type.name, options.maxGraphSize + 1);
        if (reached.length > options.maxGraphSize) return yield* new GraphTooLarge();
        if (reached.some((node) => sameNode(source, node))) return yield* new RelationCycle();
      }
      const edge: Relation = {
        id: yield* Effect.all(
          Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
        ).pipe(
          Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
        ),
        type: type.name,
        source: { ...source },
        target: { ...target },
        createdAt: DateTime.toEpochMillis(yield* DateTime.now),
      };
      yield* store.insert(edge);
      return edge;
    }),
    unrelate: Effect.fn("Relations.unrelate")(function* (id: string) {
      yield* UnitOfWork.required;
      if (!(yield* store.remove(id))) return yield* new RelationNotFound();
    }),
    listRelations: Effect.fn("Relations.listRelations")(function* (input: ListRelationsInput) {
      yield* decodeNode(input.node);
      const decoded = yield* Schema.decodeEffect(ListRelationsInput)(input).pipe(
        Effect.mapError(invalid),
      );
      if (decoded.type !== undefined) yield* getType(decoded.type);
      const size = Math.min(decoded.page?.size ?? options.maxPageSize, options.maxPageSize);
      const rows = yield* store.list(
        decoded.node,
        decoded.type,
        decoded.direction,
        size + 1,
        decoded.page?.cursor,
      );
      const edges = rows.slice(0, size);
      const last = edges[edges.length - 1];
      return rows.length > size && last !== undefined
        ? { edges, next: { createdAt: last.createdAt, id: last.id } }
        : { edges };
    }),
    subgraph: Effect.fn("Relations.subgraph")(function* (input: SubgraphInput) {
      yield* decodeNode(input.root);
      const decoded = yield* Schema.decodeEffect(SubgraphInput)(input).pipe(
        Effect.mapError(invalid),
      );
      yield* getType(decoded.type);
      const nodes = new Map([[nodeKey(decoded.root), { ...decoded.root }]]);
      const edges = new Map<string, Relation>();
      const queue = [{ node: decoded.root, depth: 0 }];
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (
          current === undefined ||
          (decoded.depth !== undefined && current.depth >= decoded.depth)
        )
          continue;
        const adjacent = yield* store.list(
          current.node,
          decoded.type,
          decoded.direction,
          options.maxGraphSize + 1,
        );
        for (const edge of adjacent) {
          edges.set(edge.id, edge);
          for (const next of neighbours(edge, current.node, decoded.direction)) {
            if (nodes.has(nodeKey(next))) continue;
            nodes.set(nodeKey(next), { ...next });
            queue.push({ node: next, depth: current.depth + 1 });
          }
          if (nodes.size > options.maxGraphSize || edges.size > options.maxGraphSize)
            return yield* new GraphTooLarge();
        }
      }
      return { nodes: [...nodes.values()], edges: [...edges.values()] };
    }),
    removeNode: Effect.fn("Relations.removeNode")(function* (ref: NodeRef) {
      yield* UnitOfWork.required;
      const node = yield* Schema.decodeEffect(NodeRef)(ref).pipe(
        Effect.mapError(() => new RelationEndpointInvalid()),
      );
      yield* store.removeNode(node);
    }),
  };
};
