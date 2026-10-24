import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Effect, Layer } from "effect";
import {
  DepthExceeded,
  WorkItemInputInvalid,
  WorkItemNotFound,
  WorkItems,
  WorkItemsMount,
  WorkItemTreeTooLarge,
} from "../../index.js";
import { MoveImportTesting } from "./move-import-testing.js";
import { stores } from "./stores.js";

const { importItems, read, features, caller, system, access, options, ref, stored } =
  MoveImportTesting;
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
    `Import validation on ${name}`,
    (it) => {
      it.effect("preserves valid closed timestamps for done and cancelled imports", () =>
        Effect.gen(function* () {
          const items = [
            { ...stored("import-done", ref("closed-import")), status: "done", closedAt: 300 },
            { ...stored("import-dropped", ref("closed-import")), status: "dropped", closedAt: 400 },
          ];
          yield* runFeature(importItems, { items }).pipe(Effect.provide(system));
          for (const item of items) expect(yield* runFeature(read, { id: item.id })).toEqual(item);
        }).pipe(Effect.provide(caller)),
      );
      it.effect(
        "validates import parent links, kinds, workflow, timestamps, content, depth and size",
        () =>
          Effect.gen(function* () {
            const invalid = new WorkItemInputInvalid({ message: "Invalid work item import." });
            const invalidBatches = [
              {
                items: [{ ...stored("missing-link"), parent: "absent" }],
                error: new WorkItemNotFound(),
              },
              {
                items: [{ ...stored("self-link"), parent: "self-link" }],
                error: new WorkItemInputInvalid({
                  message: "Work item hierarchy cannot contain a cycle.",
                }),
              },
              { items: [stored("wrong-kind", { kind: "retired", id: "x" })], error: invalid },
              {
                items: [{ ...stored("wrong-holder"), holder: { kind: "retired", id: "x" } }],
                error: invalid,
              },
              { items: [{ ...stored("wrong-status"), status: "unknown" }], error: invalid },
              {
                items: [{ ...stored("long-title"), title: "x".repeat(options.maxTitleLength + 1) }],
                error: invalid,
              },
              { items: [{ ...stored("open-closed"), closedAt: 300 }], error: invalid },
              { items: [{ ...stored("done-open"), status: "done" }], error: invalid },
              { items: [{ ...stored("dropped-open"), status: "dropped" }], error: invalid },
              { items: [{ ...stored("reversed-times"), createdAt: 457 }], error: invalid },
              {
                items: Array.from({ length: 4 }, (_, i) => ({
                  ...stored(`deep-${i}`, ref("deep-import")),
                  parent: i === 0 ? null : `deep-${i - 1}`,
                })),
                error: new DepthExceeded(),
              },
              {
                items: Array.from({ length: 5 }, (_, i) =>
                  stored(`too-many-${i}`, ref("too-many")),
                ),
                error: new WorkItemTreeTooLarge(),
              },
            ];
            for (const { items, error } of invalidBatches)
              expect(
                yield* Effect.flip(runFeature(importItems, { items }).pipe(Effect.provide(system))),
              ).toEqual(error);
          }).pipe(Effect.provide(caller)),
      );
    },
  );
}
