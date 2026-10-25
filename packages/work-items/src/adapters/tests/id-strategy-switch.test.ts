import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Effect, Layer } from "effect";
import { WorkItems, WorkItemsMount } from "../../index.js";
import { MoveImportTesting } from "./move-import-testing.js";
import { stores } from "./stores.js";

const { create, importItems, read, features, caller, system, access, options, stored, ref } =
  MoveImportTesting;
const runtime = (idStrategy: "random" | "sequence") =>
  Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
    Layer.provide(WorkItems.layer({ ...options, idStrategy }).pipe(Layer.provide(access))),
    Layer.provideMerge(StepTrace.layer()),
  );

for (const { name, layer: storeLayer } of stores)
  layer(storeLayer, { excludeTestServices: true, timeout: "30 seconds" })(
    `Id strategy switch on ${name}`,
    (it) => {
      it.effect("imports in random mode and switches to sequence without id collisions", () =>
        Effect.gen(function* () {
          const items = [
            stored("1"),
            stored("10001"),
            stored("legacy-id"),
            stored("99999999999999999999999999999"),
          ];
          yield* runFeature(importItems, { items }).pipe(
            Effect.provide(Layer.merge(runtime("random"), system)),
          );
          const random = yield* runFeature(create, {
            title: "random",
            container: ref("switch-random"),
          }).pipe(Effect.provide(Layer.merge(runtime("random"), caller)));
          expect(random.item.id).toMatch(/^[a-f0-9]{32}$/);
          const next = yield* runFeature(create, {
            title: "sequence",
            container: ref("switch-next"),
          }).pipe(Effect.provide(Layer.merge(runtime("sequence"), caller)));
          expect(next.item.id).toBe("10002");
          for (const item of items)
            expect(
              yield* runFeature(read, { id: item.id }).pipe(
                Effect.provide(Layer.merge(runtime("sequence"), caller)),
              ),
            ).toEqual(item);
        }),
      );
    },
  );
