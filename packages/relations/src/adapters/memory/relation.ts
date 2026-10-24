import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  compareRelations,
  copyRelation,
  nodeKey,
  sameNode,
  touches,
} from "../../relation/graph.js";
import { type Relation, RelationsStoreUnavailable } from "../../relation/relation.js";
import { RelationStore } from "../../storage.js";
export const memoryRelationStore = (): Layer.Layer<RelationStore> =>
  Layer.sync(RelationStore, () => {
    const rows = new Map<string, Relation>();
    const change = Effect.fn("RelationStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map([...rows].map(([id, edge]) => [id, copyRelation(edge)]));
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, edge] of before) rows.set(id, edge);
        }),
      );
      run();
    });
    return RelationStore.of({
      lock: UnitOfWork.required,
      list: (node, type, direction, size, after) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter(
              (edge) =>
                (type === undefined || edge.type === type) &&
                touches(edge, node, direction) &&
                (after === undefined || compareRelations(edge, { ...edge, ...after }) > 0),
            )
            .sort(compareRelations)
            .slice(0, size)
            .map(copyRelation),
        ),
      count: (node, type, direction) =>
        Effect.sync(
          () =>
            [...rows.values()].filter(
              (edge) => edge.type === type && touches(edge, node, direction),
            ).length,
        ),
      exists: (source, target, type) =>
        Effect.sync(() =>
          [...rows.values()].some(
            (edge) =>
              edge.type === type && sameNode(edge.source, source) && sameNode(edge.target, target),
          ),
        ),
      reachable: (root, type, limit) =>
        Effect.sync(() => {
          const nodes = [{ ...root }];
          const seen = new Set([nodeKey(root)]);
          for (let i = 0; i < nodes.length && nodes.length < limit; i++) {
            const node = nodes[i];
            if (node === undefined) break;
            for (const edge of rows.values()) {
              if (
                edge.type !== type ||
                !sameNode(edge.source, node) ||
                seen.has(nodeKey(edge.target))
              )
                continue;
              seen.add(nodeKey(edge.target));
              nodes.push({ ...edge.target });
              if (nodes.length >= limit) break;
            }
          }
          return nodes;
        }),
      insert: Effect.fn("RelationStore.memory.insert")(function* (edge: Relation) {
        yield* UnitOfWork.required;
        if (rows.has(edge.id))
          return yield* new RelationsStoreUnavailable({ cause: "Duplicate relation id." });
        yield* change(() => void rows.set(edge.id, copyRelation(edge)));
      }),
      remove: Effect.fn("RelationStore.memory.remove")(function* (id: string) {
        yield* UnitOfWork.required;
        const found = rows.has(id);
        yield* change(() => void rows.delete(id));
        return found;
      }),
      removeNode: (node) =>
        change(() => {
          for (const [id, edge] of rows) if (touches(edge, node, "both")) rows.delete(id);
        }),
    });
  });
