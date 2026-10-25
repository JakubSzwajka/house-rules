import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryWorkItemStore } from "./adapters/memory/work-item.js";
import { postgresWorkItemStore } from "./adapters/postgres/work-item.js";
import { WorkItemStore } from "./storage.js";
import { WorkItemAccess } from "./work-item/access.js";
import { WorkItemsOptions, workItemsPresets } from "./work-item/options.js";
import { WorkItemInputInvalid } from "./work-item/work-item.js";
import { makeWorkItems } from "./work-item/work-items.js";
export class WorkItems extends defineModule<WorkItems, ReturnType<typeof makeWorkItems>>()(
  "work-items",
  {
    make: (options: WorkItemsOptions) =>
      Effect.gen(function* workItemsLayer() {
        const settings = yield* Schema.decodeEffect(WorkItemsOptions)(options).pipe(
          Effect.mapError(
            () => new WorkItemInputInvalid({ message: "Invalid work items options." }),
          ),
        );
        return makeWorkItems(yield* WorkItemStore, yield* WorkItemAccess, settings);
      }),
  },
) {
  static readonly presets = workItemsPresets;
  static readonly layerMemory = (options: WorkItemsOptions) =>
    this.layer(options).pipe(Layer.provide(memoryWorkItemStore()));
  static readonly layerPostgres = (options: WorkItemsOptions) =>
    this.layer(options).pipe(Layer.provide(postgresWorkItemStore));
}
