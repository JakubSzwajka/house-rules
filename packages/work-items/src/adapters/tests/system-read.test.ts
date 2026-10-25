import { expect, layer } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import {
  WorkItemPermissions as contractPermissions,
  WorkItemsCallerDenied as ContractDenied,
} from "../../contract.js";
import {
  WorkItemAccess,
  WorkItemNotFound,
  WorkItemPermissions,
  WorkItems,
  WorkItemsCallerDenied,
  WorkItemsMount,
  WorkItemsOperations as operations,
} from "../../index.js";
import { stores } from "./stores.js";

const create = defineFeature("test_createSystemReadItem", {
  ...operations.create,
  permission: null,
  edges: [operations.create],
  handler: (input, { call }) => call(operations.create, input),
});
const read = defineFeature("test_personReadItem", {
  ...operations.get,
  permission: null,
  edges: [operations.get],
  handler: (input, { call }) => call(operations.get, input),
});
const personSystemRead = defineFeature("test_personSystemReadItem", {
  ...operations.getForSystem,
  permission: null,
  edges: [operations.getForSystem],
  handler: (input, { call }) => call(operations.getForSystem, input),
});
const start = { kind: "system", reason: "Read event subject", startedBy: "hook:test" } as const;
const systemRead = defineFeature("test_systemReadItem", {
  ...operations.getForSystem,
  permission: null,
  edges: [operations.getForSystem],
  start,
  handler: (input, { call }) => call(operations.getForSystem, input),
});
const systemPersonRead = defineFeature("test_systemPersonReadItem", {
  ...operations.get,
  permission: null,
  edges: [operations.get],
  start,
  handler: (input, { call }) => call(operations.get, input),
});
const systemList = defineFeature("test_systemListItems", {
  ...operations.list,
  permission: null,
  edges: [operations.list],
  start,
  handler: (input, { call }) => call(operations.list, input),
});
const systemTree = defineFeature("test_systemItemTree", {
  ...operations.tree,
  permission: null,
  edges: [operations.tree],
  start,
  handler: (input, { call }) => call(operations.tree, input),
});
const features = [
  create,
  read,
  personSystemRead,
  systemRead,
  systemPersonRead,
  systemList,
  systemTree,
];
const permissions = Object.values(WorkItemPermissions);
const owner = Actor.make({ id: ActorId.make("owner") });
const outsider = Actor.make({ id: ActorId.make("outsider") });
const container = { kind: "project", id: "private" };
const person = (actor: Actor) =>
  Layer.merge(
    Layer.succeed(CurrentActor, actor),
    Layer.succeedContext(
      May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
    ),
  );
const system = Layer.succeedContext(May.system(features, { system: permissions, via: "test" }));

for (const { name, layer: storeLayer } of stores) {
  const access = vi.fn((actor: Actor) =>
    Effect.succeed(actor.id === owner.id ? ("write" as const) : ("none" as const)),
  );
  const visibleContainers = vi.fn(() => Effect.succeed({ containers: [], inbox: false }));
  const module = WorkItems.layer(WorkItems.presets.board).pipe(
    Layer.provide(Layer.succeed(WorkItemAccess, { access, visibleContainers })),
    Layer.provideMerge(storeLayer),
  );
  const world = Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(StepTrace.layer()),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `System reads on ${name}`,
    (it) => {
      it.effect("reads a hidden item without consulting either access port", () =>
        Effect.gen(function* () {
          const { item } = yield* runFeature(create, { title: "private", container }).pipe(
            Effect.provide(person(owner)),
          );
          expect(
            yield* Effect.flip(
              runFeature(read, { id: item.id }).pipe(Effect.provide(person(outsider))),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
          access.mockClear();
          visibleContainers.mockClear();
          expect(
            yield* runFeature(systemRead, { id: item.id }).pipe(Effect.provide(system)),
          ).toEqual(item);
          expect(access).not.toHaveBeenCalled();
          expect(visibleContainers).not.toHaveBeenCalled();
          expect(operations.getForSystem.permission).toBe("work_items:system-read");
          expect(operations.getForSystem.readOnly).toBe(true);
          expect(operations.getForSystem.transactional).toBe(false);
          expect(contractPermissions.systemRead).toBe(WorkItemPermissions.systemRead);
          expect(ContractDenied).toBe(WorkItemsCallerDenied);
          expect((yield* Runtime).permissions).toContain("work_items:system-read");
        }),
      );
      it.effect("refuses even an authorized person with the forbidden caller error", () =>
        Effect.gen(function* () {
          const { item } = yield* runFeature(create, { title: "owner can read", container }).pipe(
            Effect.provide(person(owner)),
          );
          expect(
            yield* runFeature(read, { id: item.id }).pipe(Effect.provide(person(owner))),
          ).toEqual(item);
          const denied = yield* Effect.flip(
            runFeature(personSystemRead, { id: item.id }).pipe(Effect.provide(person(owner))),
          );
          expect(denied).toBeInstanceOf(WorkItemsCallerDenied);
          expect(denied.kind).toBe("forbidden");
          expect(
            yield* Effect.flip(
              runFeature(personSystemRead, { id: "missing" }).pipe(Effect.provide(person(owner))),
            ),
          ).toBeInstanceOf(WorkItemsCallerDenied);
        }),
      );
      it.effect("refuses a system caller without system-read at the runtime gate", () =>
        Effect.gen(function* () {
          const denied = yield* Effect.flip(
            runFeature(systemRead, { id: "missing" }).pipe(
              Effect.provide(
                Layer.succeedContext(May.system(features, { system: [], via: "test" })),
              ),
            ),
          );
          expect(denied._tag).toBe("Forbidden");
          expect(denied.kind).toBe("forbidden");
        }),
      );
      it.effect("returns not_found for a missing system read", () =>
        Effect.gen(function* () {
          expect(
            yield* Effect.flip(
              runFeature(systemRead, { id: "missing" }).pipe(Effect.provide(system)),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
        }),
      );
      it.effect("keeps get, list and tree person-only", () =>
        Effect.gen(function* () {
          const { item } = yield* runFeature(create, { title: "person only", container }).pipe(
            Effect.provide(person(owner)),
          );
          expect(
            yield* Effect.flip(
              runFeature(systemPersonRead, { id: item.id }).pipe(Effect.provide(system)),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
          expect(
            yield* Effect.flip(runFeature(systemList, {}).pipe(Effect.provide(system))),
          ).toBeInstanceOf(WorkItemNotFound);
          expect(
            yield* Effect.flip(runFeature(systemTree, { container }).pipe(Effect.provide(system))),
          ).toBeInstanceOf(WorkItemNotFound);
        }),
      );
    },
  );
}
