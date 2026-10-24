import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { GraphTooLarge, Relations, RelationsInputInvalid } from "../../index.js";
import { stores } from "./stores.js";
const node = (id: string) => ({ kind: "item", id });
for (const { name, layer: storage } of stores) {
  const world = Relations.layer({
    nodeKinds: ["item"],
    maxPageSize: 2,
    maxGraphSize: 5,
    relationTypes: [
      {
        name: "link",
        source: ["item"],
        target: ["item"],
        directed: true,
        acyclic: false,
        unique: false,
      },
    ],
  }).pipe(Layer.provideMerge(storage));
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Relation graph on ${name}`,
    (it) => {
      it.effect("traverses BFS with depth and direction, deduplicating converging paths", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          for (const [source, target] of [
            ["a", "b"],
            ["a", "c"],
            ["b", "d"],
            ["c", "d"],
          ] as const)
            yield* UnitOfWork.atomic(
              service.relate({ type: "link", source: node(source), target: node(target) }),
            );
          const graph = yield* service.subgraph({
            root: node("a"),
            type: "link",
            direction: "out",
          });
          expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"]);
          expect(graph.edges).toHaveLength(4);
          expect(
            (yield* service.subgraph({ root: node("a"), type: "link", direction: "out", depth: 1 }))
              .nodes,
          ).toHaveLength(3);
          expect(
            (yield* service.subgraph({ root: node("d"), type: "link", direction: "in" })).nodes,
          ).toHaveLength(4);
          expect(
            (yield* service.subgraph({ root: node("d"), type: "link", direction: "out" })).edges,
          ).toEqual([]);
          expect(
            yield* service.subgraph({
              root: node("absent-root"),
              type: "link",
              direction: "both",
              depth: 0,
            }),
          ).toEqual({ nodes: [node("absent-root")], edges: [] });
          expect(
            yield* Effect.flip(
              service.subgraph({ root: node("a"), type: "link", direction: "out", depth: -1 }),
            ),
          ).toBeInstanceOf(RelationsInputInvalid);
        }),
      );
      it.effect("fails closed when BFS exceeds node or edge limits", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          for (let i = 0; i < 5; i++)
            yield* UnitOfWork.atomic(
              service.relate({ type: "link", source: node("fan-root"), target: node(`fan-${i}`) }),
            );
          expect(
            yield* Effect.flip(
              service.subgraph({ root: node("fan-root"), type: "link", direction: "out" }),
            ),
          ).toBeInstanceOf(GraphTooLarge);
          for (let i = 0; i < 6; i++)
            yield* UnitOfWork.atomic(
              service.relate({
                type: "link",
                source: node("dense-root"),
                target: node("dense-target"),
              }),
            );
          expect(
            yield* Effect.flip(
              service.subgraph({ root: node("dense-root"), type: "link", direction: "out" }),
            ),
          ).toBeInstanceOf(GraphTooLarge);
        }),
      );
      it.effect("terminates on cyclic graphs and keeps kind/id pairs distinct", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          for (const [source, target] of [
            ["cycle-a", "cycle-b"],
            ["cycle-b", "cycle-a"],
            ["cycle-a", "cycle-a"],
          ] as const)
            yield* UnitOfWork.atomic(
              service.relate({ type: "link", source: node(source), target: node(target) }),
            );
          const graph = yield* service.subgraph({
            root: node("cycle-a"),
            type: "link",
            direction: "both",
          });
          expect(graph.nodes).toHaveLength(2);
          expect(graph.edges).toHaveLength(3);
        }),
      );
    },
  );
}
