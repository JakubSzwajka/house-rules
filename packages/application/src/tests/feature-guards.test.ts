import { expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { defineFeature } from "../contract.ts";
import {
  bindOperation,
  composition,
  CurrentActor,
  defineWay,
  GraphInvalid,
  May,
  Mean,
  Runtime,
  runFeature,
  StepTrace,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";

const options = {
  description: "Secret",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: "secrets:write",
} as const;

it.effect(
  "refuses the reviewer's forged feature exposed on a way before its missing-permission handler",
  () =>
    Effect.gen(function* () {
      let handlerRan = false;
      const operation = defineOperation("secret", options);
      const control = defineFeature("control", { ...options, handler: () => Effect.void });
      const forged = {
        ...operation,
        kind: "feature",
        start: "person",
        closures: { person: [], system: [] },
        handler: () =>
          Effect.sync(() => {
            handlerRan = true;
          }),
      } as unknown as typeof control;
      const way = defineWay({
        name: "probe",
        protocol: "http",
        path: "/",
        features: [forged],
        endpoints: [],
        who: { resolve: () => Effect.succeed(testActor) },
        mean: Mean.no,
      });
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const runtime = yield* Runtime.make({ features: [forged], bindings: [], ways: [way] });
          return yield* runFeature(forged, {}).pipe(Effect.provideService(Runtime, runtime));
        }).pipe(
          Effect.provide(StepTrace.layer()),
          Effect.provideService(CurrentActor, testActor),
          Effect.provideContext(
            May.context(May.fixed([]), { features: way.features, system: [], via: "probe" }),
          ),
        ),
      );
      expect(error).toBeInstanceOf(GraphInvalid);
      expect(error).toMatchObject({ reason: "Feature was not created by defineFeature: secret" });
      expect(handlerRan).toBe(false);
    }),
);

it.effect("rejects copies even when they retain the private symbol brand", () =>
  Effect.gen(function* () {
    const real = defineFeature("secret", { ...options, handler: () => Effect.void });
    for (const forged of [
      { ...real },
      { ...real, closures: { person: [], system: [] } },
      { ...real, transactional: false, needsApproval: false, start: "person" as const },
    ]) {
      const error = yield* Effect.flip(
        Runtime.make({ features: [forged], bindings: [], ways: [] }),
      );
      expect(error).toBeInstanceOf(GraphInvalid);
    }
  }),
);

it.effect("recomputes closures and lifted flags from reachable operations at acquisition", () =>
  Effect.gen(function* () {
    for (const change of [
      "permission",
      "transactional",
      "destructive",
      "needsApproval",
      "readOnly",
    ] as const) {
      const operation = {
        ...defineOperation("child", { ...options, permission: null, readOnly: true }),
      };
      const feature = defineFeature("parent", {
        ...options,
        flags: { readOnly: true },
        edges: [operation],
        handler: () => Effect.void,
      });
      if (change === "permission") Object.assign(operation, { permission: "hidden:write" });
      else Object.assign(operation, { [change]: change !== "readOnly" });
      const error = yield* Effect.flip(
        Runtime.make({
          features: [feature],
          bindings: [bindOperation(operation, () => Effect.void)],
          ways: [],
        }),
      );
      expect(error).toBeInstanceOf(GraphInvalid);
      expect(error.reason).toMatch(/Invalid (person closure|lifted flags)|Read-only/u);
    }
  }),
);

it.effect("composition revalidates its actual features against the acquired graph", () =>
  Effect.gen(function* () {
    const real = defineFeature("secret", { ...options, handler: () => Effect.void });
    const forged = { ...real, closures: { person: [], system: [] } };
    const app = composition({
      layer: Layer.merge(
        Runtime.layer({ features: [real], bindings: [], ways: [] }),
        StepTrace.layer(),
      ),
      features: [forged],
      ways: [],
      may: May.fixed([]),
      system: [],
    });
    const error = yield* Effect.flip(app.runtime.contextEffect);
    expect(error).toBeInstanceOf(GraphInvalid);
    expect(error.reason).toContain("Feature was not created by defineFeature");
    yield* Effect.promise(() => app.dispose());
  }),
);

it("copies and freezes system starts and permission closures", () => {
  const start = { kind: "system" as const, reason: "job", startedBy: "schedule" };
  const feature = defineFeature("job", { ...options, start, handler: () => Effect.void });
  start.reason = "";
  expect(feature.start.reason).toBe("job");
  expect(Object.isFrozen(feature.start)).toBe(true);
  expect(Object.isFrozen(feature.closures.system)).toBe(true);
});
