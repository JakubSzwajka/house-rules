import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Result, Schema } from "effect";
import {
  DuplicateRelation,
  GraphTooLarge,
  RelationCardinalityExceeded,
  RelationCycle,
  RelationEndpointInvalid,
  RelationNotFound,
  Relations,
  RelationsInputInvalid,
  type RelationsOptions,
  RelationTypeUnknown,
} from "../../index.js";
import { stores } from "./stores.js";
const node = (id: string, kind = "item") => ({ kind, id });
const base = {
  source: ["item", "folder"],
  target: ["item", "folder"],
  directed: true,
  acyclic: false,
  unique: true,
};
const options: RelationsOptions = {
  nodeKinds: ["item", "folder"],
  maxPageSize: 2,
  maxGraphSize: 5,
  relationTypes: [
    { ...base, name: "dag", acyclic: true },
    { ...base, name: "limited", maxOutPerSource: 1, maxInPerTarget: 1 },
    { ...base, name: "symmetric", directed: false, maxDegree: 2 },
    { ...base, name: "cross", directed: false, source: ["folder"], target: ["item"] },
    { ...base, name: "parallel", unique: false },
    { ...base, name: "loop" },
  ],
};
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
for (const { name, layer: storage } of stores) {
  const world = Relations.layer(options).pipe(Layer.provideMerge(storage));
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Relations on ${name}`,
    (it) => {
      it.effect("validates configured kinds and types without asking for endpoint existence", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (type: string, source = node("opaque"), target = node("absent")) =>
            UnitOfWork.atomic(service.relate({ type, source, target }));
          expect(yield* Effect.flip(add("unknown"))).toBeInstanceOf(RelationTypeUnknown);
          expect(yield* Effect.flip(add("dag", node("x", "unknown")))).toBeInstanceOf(
            RelationEndpointInvalid,
          );
          expect(yield* Effect.flip(add("dag", node("")))).toBeInstanceOf(RelationEndpointInvalid);
          expect(yield* Effect.flip(add("cross", node("item-a"), node("item-b")))).toBeInstanceOf(
            RelationEndpointInvalid,
          );
          const { relation: edge } = yield* add("cross", node("z", "folder"), node("a"));
          expect(edge.source.kind).toBe("folder");
          expect(yield* add("dag")).toMatchObject({
            relation: { source: node("opaque"), target: node("absent") },
          });
        }),
      );
      it.effect("canonicalizes symmetric edges and enforces reverse uniqueness", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const { relation: edge } = yield* UnitOfWork.atomic(
            service.relate({ type: "symmetric", source: node("sym-z"), target: node("sym-a") }),
          );
          expect(edge.source).toEqual(node("sym-a"));
          expect(edge.target).toEqual(node("sym-z"));
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                service.relate({ type: "symmetric", source: node("sym-a"), target: node("sym-z") }),
              ),
            ),
          ).toBeInstanceOf(DuplicateRelation);
          for (const id of ["sym-a", "sym-z"])
            expect(
              (yield* service.listRelations({
                node: node(id),
                type: "symmetric",
                direction: "both",
              })).edges,
            ).toEqual([edge]);
          expect(
            (yield* service.listRelations({ node: node("sym-z"), direction: "out" })).edges,
          ).toEqual([]);
          expect(
            (yield* service.subgraph({ root: node("sym-z"), type: "symmetric", direction: "both" }))
              .nodes,
          ).toHaveLength(2);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                service.relate({ type: "cross", source: node("a"), target: node("z", "folder") }),
              ),
            ),
          ).toBeInstanceOf(DuplicateRelation);
        }),
      );
      it.effect("enforces directed and symmetric cardinalities per type", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (type: string, source: string, target: string) =>
            UnitOfWork.atomic(service.relate({ type, source: node(source), target: node(target) }));
          yield* add("limited", "cap-a", "cap-b");
          expect(yield* Effect.flip(add("limited", "cap-a", "cap-c"))).toBeInstanceOf(
            RelationCardinalityExceeded,
          );
          expect(yield* Effect.flip(add("limited", "cap-c", "cap-b"))).toBeInstanceOf(
            RelationCardinalityExceeded,
          );
          yield* add("parallel", "cap-a", "cap-b");
          yield* add("symmetric", "degree-b", "degree-a");
          yield* add("symmetric", "degree-c", "degree-b");
          expect(yield* Effect.flip(add("symmetric", "degree-d", "degree-b"))).toBeInstanceOf(
            RelationCardinalityExceeded,
          );
          yield* add("symmetric", "degree-self", "degree-self");
          yield* add("symmetric", "degree-self", "degree-extra");
          expect(yield* Effect.flip(add("symmetric", "degree-self", "degree-last"))).toBeInstanceOf(
            RelationCardinalityExceeded,
          );
        }),
      );
      it.effect("rejects directed cycles, self-cycles, and oversized cycle searches", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (type: string, source: string, target: string) =>
            UnitOfWork.atomic(service.relate({ type, source: node(source), target: node(target) }));
          yield* add("dag", "cycle-a", "cycle-b");
          yield* add("dag", "cycle-b", "cycle-c");
          expect(yield* Effect.flip(add("dag", "cycle-c", "cycle-a"))).toBeInstanceOf(
            RelationCycle,
          );
          expect(yield* Effect.flip(add("dag", "cycle-self", "cycle-self"))).toBeInstanceOf(
            RelationCycle,
          );
          yield* add("loop", "loop-self", "loop-self");
          for (let i = 0; i < 5; i++) yield* add("dag", `large-${i}`, `large-${i + 1}`);
          expect(yield* Effect.flip(add("dag", "large-new", "large-0"))).toBeInstanceOf(
            GraphTooLarge,
          );
          expect(
            (yield* service.listRelations({ node: node("large-new"), direction: "both" })).edges,
          ).toEqual([]);
        }),
      );
      it.effect("allows parallel edges only when configured, and caps list pages", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          for (let i = 0; i < 3; i++)
            yield* UnitOfWork.atomic(
              service.relate({ type: "parallel", source: node("pages"), target: node("same") }),
            );
          const first = yield* service.listRelations({
            node: node("pages"),
            direction: "out",
            page: { size: 100 },
          });
          expect(first.edges).toHaveLength(2);
          expect(first.next).toBeDefined();
          const second = yield* service.listRelations({
            node: node("pages"),
            direction: "out",
            page: first.next === undefined ? {} : { cursor: first.next },
          });
          expect(second.edges).toHaveLength(1);
          expect(second.next).toBeUndefined();
          expect(new Set([...first.edges, ...second.edges].map((e) => e.id)).size).toBe(3);
          expect(
            yield* Effect.flip(
              service.listRelations({ node: node("pages"), direction: "both", page: { size: 0 } }),
            ),
          ).toBeInstanceOf(RelationsInputInvalid);
          expect(
            yield* Effect.flip(
              service.listRelations({ node: node("pages"), direction: "both", type: "missing" }),
            ),
          ).toBeInstanceOf(RelationTypeUnknown);
        }),
      );
      it.effect("joins the deletion unit, rolls back, and cascades idempotently", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const { relation: edge } = yield* UnitOfWork.atomic(
            service.relate({ type: "dag", source: node("delete"), target: node("delete-target") }),
          );
          yield* UnitOfWork.atomic(
            service.relate({
              type: "parallel",
              source: node("delete-other"),
              target: node("delete"),
            }),
          );
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(
                Effect.gen(function* () {
                  yield* service.unrelate(edge.id);
                  yield* service.removeNode(node("delete"));
                  yield* service.relate({
                    type: "dag",
                    source: node("delete"),
                    target: node("new"),
                  });
                  return yield* new Rollback();
                }),
              ),
            ),
          ).toBeInstanceOf(Rollback);
          expect(
            (yield* service.listRelations({ node: node("delete"), direction: "both" })).edges,
          ).toHaveLength(2);
          expect(yield* UnitOfWork.atomic(service.unrelate(edge.id))).toEqual({
            events: [
              {
                kind: "Unrelated",
                type: "dag",
                source: node("delete"),
                target: node("delete-target"),
              },
            ],
          });
          expect(yield* Effect.flip(UnitOfWork.atomic(service.unrelate(edge.id)))).toBeInstanceOf(
            RelationNotFound,
          );
          expect(yield* UnitOfWork.atomic(service.removeNode(node("delete")))).toBeUndefined();
          expect(yield* UnitOfWork.atomic(service.removeNode(node("delete")))).toBeUndefined();
          expect(
            (yield* service.listRelations({ node: node("delete"), direction: "both" })).edges,
          ).toEqual([]);
          expect(
            yield* Effect.flip(
              service.relate({ type: "dag", source: node("outside"), target: node("other") }),
            ),
          ).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(service.unrelate("outside"))).toBeInstanceOf(NoOpenUnit);
          expect(yield* Effect.flip(service.removeNode(node("outside")))).toBeInstanceOf(
            NoOpenUnit,
          );
        }),
      );
      it.effect("serializes concurrent uniqueness, cardinality and cycle checks", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          for (const [type, pairs, failure] of [
            [
              "dag",
              [
                ["race-u-a", "race-u-b"],
                ["race-u-a", "race-u-b"],
              ],
              DuplicateRelation,
            ],
            [
              "limited",
              [
                ["race-c-a", "race-c-b"],
                ["race-c-a", "race-c-c"],
              ],
              RelationCardinalityExceeded,
            ],
            [
              "dag",
              [
                ["race-d-a", "race-d-b"],
                ["race-d-b", "race-d-a"],
              ],
              RelationCycle,
            ],
          ] as const) {
            const results = yield* Effect.all(
              pairs.map(([source, target]) =>
                UnitOfWork.atomic(
                  service.relate({ type, source: node(source), target: node(target) }),
                ).pipe(Effect.result),
              ),
              { concurrency: "unbounded" },
            );
            expect(results.filter(Result.isSuccess)).toHaveLength(1);
            const rejected = results.find(Result.isFailure);
            expect(rejected?.failure).toBeInstanceOf(failure);
          }
        }),
      );
    },
  );
}
