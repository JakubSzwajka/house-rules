import { expect, it } from "@effect/vitest";
import { asSystem, defineOperation, memoryUnitOfWork, NoInput } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import {
  appMap,
  bindOperation,
  composition,
  defineFeature,
  May,
  renderMap,
  StepTrace,
  type Binding,
} from "../index.ts";

class Store extends Context.Service<Store, object>()("test/map/Store") {}

it.effect("maps callers, reasons, closures and exposure without executing handlers", () =>
  Effect.gen(function* () {
    const base = {
      description: "Test",
      input: NoInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
    } as const;
    const child = defineOperation("child", { ...base, permission: "items:read" });
    const root = defineOperation("root", { ...base, edges: [asSystem(child, "background read")] });
    const second = defineOperation("second", { ...base, edges: [child] });
    const feature = defineFeature("read_items", {
      ...base,
      edges: [root],
      handler: (input, { call }) => call(root, input),
    });
    let calls = 0;
    const modules = {
      mounts: [
        {
          service: Store,
          layer: Layer.succeed(Store, {}),
          operations: [child, root, second],
          bind: (_store: Store["Service"]): readonly Binding[] =>
            [child, root, second].map((operation) =>
              bindOperation(operation, () =>
                Effect.sync(() => {
                  calls += 1;
                }),
              ),
            ),
        },
      ] as const,
      layer: Layer.merge(StepTrace.layer(), memoryUnitOfWork),
    };
    const app = composition({
      modules,
      features: [feature],
      ways: [],
      may: Effect.succeed(May.fixed([])),
      system: ["items:read"],
    });
    try {
      const snapshot = yield* appMap(app);
      const operations = snapshot.modules.flatMap((module) => module.operations);
      expect(
        operations
          .filter((operation) => operation.edges.some((edge) => edge.target === "child"))
          .map((operation) => operation.name),
      ).toEqual(["root", "second"]);
      expect(operations.find((operation) => operation.name === "root")?.edges).toEqual([
        { target: "child", kind: "operation", reason: "background read" },
      ]);
      expect(snapshot.features[0]?.closures).toEqual({ person: [], system: ["items:read"] });
      expect(snapshot.features[0]?.ways).toEqual([]);
      expect(renderMap(snapshot, "text")).toBe(renderMap(yield* appMap(app), "text"));
      expect(calls).toBe(0);
    } finally {
      yield* Effect.promise(app.dispose);
    }
  }),
);
