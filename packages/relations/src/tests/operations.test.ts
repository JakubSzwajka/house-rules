import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { bindRelations, Relations, RelationsMount, RelationsOperations } from "../index.js";
expectTypeOf<Parameters<typeof bindRelations>[0]>().toExtend<Relations["Service"]>();
const { relate, unrelate, listRelations, subgraph } = RelationsOperations;
const add = defineFeature("test_relate", {
  ...relate,
  permission: null,
  edges: [relate],
  handler: (input, { call }) => call(relate, input),
});
const remove = defineFeature("test_unrelate", {
  ...unrelate,
  permission: null,
  edges: [unrelate],
  handler: (input, { call }) => call(unrelate, input),
});
const list = defineFeature("test_listRelations", {
  ...listRelations,
  permission: null,
  edges: [listRelations],
  handler: (input, { call }) => call(listRelations, input),
});
const graph = defineFeature("test_subgraph", {
  ...subgraph,
  permission: null,
  edges: [subgraph],
  handler: (input, { call }) => call(subgraph, input),
});
const systemAdd = defineFeature("test_systemRelate", {
  ...relate,
  permission: null,
  edges: [relate],
  start: { kind: "system", reason: "test structural import", startedBy: "hook:test" },
  handler: (input, { call }) => call(relate, input),
});
const features = [add, remove, list, graph, systemAdd];
const permissions = ["relations:read", "relations:write"] as const;
const world = Runtime.layer({ mounts: [RelationsMount], features, ways: [] }).pipe(
  Layer.provideMerge(
    Relations.layerMemory({
      nodeKinds: ["item"],
      maxPageSize: 10,
      maxGraphSize: 10,
      relationTypes: [
        {
          name: "link",
          source: ["item"],
          target: ["item"],
          directed: true,
          acyclic: true,
          unique: true,
        },
      ],
    }),
  ),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const caller = Layer.merge(
  Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("actor") })),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);
it.layer(world)("Relations operation bindings", (test) => {
  test.effect("binds all four operations and opens feature units", () =>
    Effect.gen(function* () {
      expect(RelationsMount.bind).toBe(bindRelations);
      expect(RelationsMount.service).toBe(Relations);
      expect(RelationsMount.operations).toEqual(Object.values(RelationsOperations));
      expect(relate.transactional).toBe(true);
      expect(unrelate.destructive).toBe(true);
      expect(listRelations.readOnly).toBe(true);
      expect(subgraph.readOnly).toBe(true);
      const source = { kind: "item", id: "a" };
      const target = { kind: "item", id: "b" };
      const edge = yield* runFeature(add, { type: "link", source, target }).pipe(
        Effect.provide(caller),
      );
      expect(
        (yield* runFeature(list, { node: source, direction: "out" }).pipe(Effect.provide(caller)))
          .edges,
      ).toEqual([edge]);
      expect(
        (yield* runFeature(graph, { root: source, type: "link", direction: "out" }).pipe(
          Effect.provide(caller),
        )).nodes,
      ).toHaveLength(2);
      yield* runFeature(remove, { id: edge.id }).pipe(Effect.provide(caller));
      expect(
        (yield* runFeature(list, { node: source, direction: "both" }).pipe(Effect.provide(caller)))
          .edges,
      ).toEqual([]);
    }),
  );
  test.effect("supports system callers without person authority or a host port", () =>
    Effect.gen(function* () {
      expect(
        yield* runFeature(systemAdd, {
          type: "link",
          source: { kind: "item", id: "system-a" },
          target: { kind: "item", id: "system-b" },
        }).pipe(Effect.provide(caller)),
      ).toMatchObject({ type: "link" });
    }),
  );
});
