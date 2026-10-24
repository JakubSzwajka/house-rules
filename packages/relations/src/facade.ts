import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryRelationStore } from "./adapters/memory/relation.js";
import { postgresRelationStore } from "./adapters/postgres/relation.js";
import { RelationsOptions } from "./relation/options.js";
import { RelationsInputInvalid } from "./relation/relation.js";
import { makeRelations } from "./relation/relations.js";
import { RelationStore } from "./storage.js";
export class Relations extends defineModule<Relations, ReturnType<typeof makeRelations>>()(
  "relations",
  {
    make: (options: RelationsOptions) =>
      Effect.gen(function* relationsLayer() {
        const settings = yield* Schema.decodeEffect(RelationsOptions)(options).pipe(
          Effect.mapError(() => new RelationsInputInvalid()),
        );
        const store = yield* RelationStore;
        return makeRelations(store, settings);
      }),
  },
) {
  static readonly presets = { default: { maxGraphSize: 1000, maxPageSize: 100 } } as const;
  static readonly layerMemory = (options: RelationsOptions) =>
    this.layer(options).pipe(Layer.provide(memoryRelationStore()));
  static readonly layerPostgres = (options: RelationsOptions) =>
    this.layer(options).pipe(Layer.provide(postgresRelationStore));
}
