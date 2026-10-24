import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Effect, Layer } from "effect";
import {
  WorkItemInputInvalid,
  WorkItems,
  WorkItemsMount,
  WorkItemTreeTooLarge,
} from "../../index.js";
import { MoveImportTesting } from "./move-import-testing.js";
import { stores } from "./stores.js";
const { create, move, read, features, caller, access, options, ref } = MoveImportTesting;

for (const { name, layer: storeLayer } of stores) {
  const module = WorkItems.layer(options).pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(access),
  );
  const world = Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(StepTrace.layer()),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Move races on ${name}`,
    (it) => {
      it.effect("serializes opposing moves so they cannot create a cycle", () =>
        Effect.gen(function* () {
          const a = (yield* runFeature(create, { title: "a", container: ref("cycle-race") })).item;
          const b = (yield* runFeature(create, { title: "b", container: ref("cycle-race") })).item;
          const outcomes = yield* Effect.forEach(
            [
              { id: a.id, to: { parent: b.id } },
              { id: b.id, to: { parent: a.id } },
            ],
            (input) => runFeature(move, input).pipe(Effect.result),
            { concurrency: "unbounded" },
          );
          expect(outcomes.filter((outcome) => outcome._tag === "Success")).toHaveLength(1);
          const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
          expect(failures).toHaveLength(1);
          expect(failures[0]?.failure).toBeInstanceOf(WorkItemInputInvalid);
          const currentA = yield* runFeature(read, { id: a.id });
          const currentB = yield* runFeature(read, { id: b.id });
          expect(currentA.parent === null || currentB.parent === null).toBe(true);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("serializes moves into the last available target space", () =>
        Effect.gen(function* () {
          const a = (yield* runFeature(create, { title: "a", container: ref("size-a") })).item;
          const b = (yield* runFeature(create, { title: "b", container: ref("size-b") })).item;
          for (let i = 0; i < options.maxTreeSize - 1; i++)
            yield* runFeature(create, { title: "target item", container: ref("size-target") });
          const outcomes = yield* Effect.forEach(
            [a.id, b.id],
            (id) =>
              runFeature(move, { id, to: { container: ref("size-target") } }).pipe(Effect.result),
            { concurrency: "unbounded" },
          );
          expect(outcomes.filter((outcome) => outcome._tag === "Success")).toHaveLength(1);
          const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
          expect(failures).toHaveLength(1);
          expect(failures[0]?.failure).toBeInstanceOf(WorkItemTreeTooLarge);
        }).pipe(Effect.provide(caller)),
      );
    },
  );
}
