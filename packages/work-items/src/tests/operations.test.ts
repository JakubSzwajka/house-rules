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
import { Effect, Layer, Schema } from "effect";
import {
  bindWorkItems,
  WorkItemAccess,
  WorkItemCreate,
  WorkItemFailure,
  WorkItemMutation,
  WorkItemNotFound,
  WorkItemPermissions,
  WorkItems,
  WorkItemsMount,
  WorkItemsOperations,
} from "../index.js";
expectTypeOf<Parameters<typeof bindWorkItems>[0]>().toExtend<WorkItems["Service"]>();
it("describes claiming an unheld item or the caller's current item", () => {
  expect(WorkItemsOperations.claim.description).toBe(
    "Claim an open item that is unheld or already held by the caller.",
  );
});
expectTypeOf<WorkItems["Service"]>().toExtend<Parameters<typeof bindWorkItems>[0]>();
const operations = WorkItemsOperations;
const flow = defineFeature("test_workItemFlow", {
  input: WorkItemCreate,
  output: WorkItemMutation,
  failure: WorkItemFailure,
  description: "Exercise every work item binding in one feature unit.",
  permission: null,
  edges: Object.values(operations),
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const created = yield* call(operations.create, input);
      const id = created.item.id;
      const edited = yield* call(operations.edit, { id, patch: { body: "edited" } });
      const assigned = yield* call(operations.assign, { id, holder: null });
      const moved = yield* call(operations.setStatus, { id, status: "blocked" });
      const claimed = yield* call(operations.claim, { id });
      const released = yield* call(operations.release, { id });
      const item = yield* call(operations.get, { id });
      yield* call(operations.list, { container: item.container });
      yield* call(operations.tree, { container: item.container });
      return {
        item,
        events: [
          ...created.events,
          ...edited.events,
          ...assigned.events,
          ...moved.events,
          ...claimed.events,
          ...released.events,
        ],
      };
    }),
});
const read = defineFeature("test_workItemRead", {
  ...operations.get,
  permission: null,
  edges: [operations.get],
  handler: (input, { call }) => call(operations.get, input),
});
const list = defineFeature("test_workItemList", {
  ...operations.list,
  permission: null,
  edges: [operations.list],
  handler: (input, { call }) => call(operations.list, input),
});
const system = defineFeature("test_systemWorkItemRead", {
  ...operations.get,
  permission: null,
  edges: [operations.get],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(operations.get, input),
});
const features = [flow, read, list, system];
const permissions = Object.values(WorkItemPermissions);
const access = Layer.succeed(WorkItemAccess, {
  access: (actor, ref) => Effect.succeed(ref?.id === actor.id ? "write" : "none"),
  visibleContainers: (actor) =>
    Effect.succeed({ containers: [{ kind: "project", id: actor.id }], inbox: false }),
});
const module = WorkItems.layerMemory(WorkItems.presets.board).pipe(Layer.provide(access));
const world = Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
  Layer.provideMerge(module),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const a = Actor.make({ id: ActorId.make("a") });
const b = Actor.make({ id: ActorId.make("b") });
const caller = (actor: Actor) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(
      May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
    ),
  );
it.layer(world)("WorkItems operation bindings", (test) => {
  test.effect("mounts all ten bindings and returns typed event facts through the runtime", () =>
    Effect.gen(function* () {
      expect(WorkItemsMount.service).toBe(WorkItems);
      expect(WorkItemsMount.bind).toBe(bindWorkItems);
      expect(WorkItemsMount.operations).toEqual(Object.values(operations));
      for (const operation of Object.values(operations)) {
        const write = operation.permission === "work_items:write";
        expect(operation.transactional).toBe(write);
        expect(operation.readOnly).toBe(!write);
        expect(operation.destructive).toBe(operation === operations.edit);
      }
      const result = yield* runFeature(flow, {
        title: "runtime",
        container: { kind: "project", id: "a" },
      }).pipe(Effect.provide(caller(a)));
      expect(yield* Schema.decodeEffect(WorkItemMutation)(result)).toEqual(result);
      expect(result.item).toMatchObject({ body: "edited", status: "todo", holder: null });
      expect(result.events.map((event) => event.kind)).toEqual([
        "work_items.created",
        "work_items.edited",
        "work_items.assigned",
        "work_items.status_changed",
        "work_items.claimed",
        "work_items.released",
      ]);
      expect(
        yield* runFeature(read, { id: result.item.id }).pipe(Effect.provide(caller(a))),
      ).toEqual(result.item);
      expect(
        yield* Effect.flip(
          runFeature(read, { id: result.item.id }).pipe(Effect.provide(caller(b))),
        ),
      ).toBeInstanceOf(WorkItemNotFound);
      expect(yield* runFeature(list, {}).pipe(Effect.provide(caller(b)))).toEqual({ items: [] });
      expect(
        yield* Effect.flip(
          runFeature(system, { id: result.item.id }).pipe(Effect.provide(caller(a))),
        ),
      ).toBeInstanceOf(WorkItemNotFound);
    }),
  );
});
