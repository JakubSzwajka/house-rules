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
import {
  WorkItemAccess,
  WorkItemPermissions,
  WorkItems,
  WorkItemsMount,
  WorkItemsOperations as operations,
} from "../../index.js";
import { stores } from "./stores.js";

const create = defineFeature("test_restartCreate", {
  ...operations.create,
  permission: null,
  edges: [operations.create],
  handler: (input, { call }) => call(operations.create, input),
});
const features = [create];
const permissions = Object.values(WorkItemPermissions);
const caller = Layer.merge(
  Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("owner") })),
  Layer.succeedContext(May.context(May.fixed(permissions), { features, system: [], via: "test" })),
);
const access = Layer.succeed(WorkItemAccess, {
  access: () => Effect.succeed("write"),
  visibleContainers: () => Effect.succeed({ containers: [], inbox: true }),
});
const restart = () =>
  Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
    Layer.provide(
      WorkItems.layerPostgres({ ...WorkItems.presets.board, idStrategy: "sequence" }).pipe(
        Layer.provide(access),
      ),
    ),
    Layer.provideMerge(StepTrace.layer()),
  );
layer(stores[0].layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "Postgres id restart",
  (it) => {
    it.effect("keeps increasing after rebuilding the module, adapter and runtime", () =>
      Effect.gen(function* () {
        const first = yield* runFeature(create, { title: "before restart" }).pipe(
          Effect.provide(Layer.merge(restart(), caller)),
        );
        const second = yield* runFeature(create, { title: "after restart" }).pipe(
          Effect.provide(Layer.merge(restart(), caller)),
        );
        expect(first.item.id).toBe("1");
        expect(second.item.id).toBe("2");
      }),
    );
  },
);
