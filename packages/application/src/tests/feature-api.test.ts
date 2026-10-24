import { expect, expectTypeOf, it } from "@effect/vitest";
import { memoryUnitOfWork } from "@house-rules/domain";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain/contract";
import { Context, Effect, Layer, Schema } from "effect";
import { defineFeature, endpoint, systemStart } from "../contract.ts";
import {
  bindOperation,
  call,
  composition,
  type Composition,
  CurrentActor,
  CallPermissions,
  defineWay,
  GraphInvalid,
  May,
  Mean,
  Runtime,
  runFeature,
  StepTrace,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";

const base = {
  description: "Test",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;
const operation = defineOperation("write_operation", {
  ...base,
  permission: "items:write",
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const feature = defineFeature("write_feature", {
  ...base,
  edges: [operation],
  flags: { transactional: false },
  handler: (input, { call }) => call(operation, input),
});
const read = defineFeature("read_feature", {
  ...base,
  flags: { readOnly: true },
  handler: () => Effect.void,
});
const system = defineFeature("system_feature", {
  ...base,
  start: systemStart("hook:first-sign-in"),
  handler: () => Effect.void,
});
const way = {
  name: "web",
  path: "/",
  protocol: "http",
  who: { resolve: () => Effect.succeed(testActor) },
  mean: Mean.no,
} as const;

const negative = () => {
  const forged = {
    ...operation,
    kind: "feature" as const,
    start: "person" as const,
    flags: { readOnly: false, transactional: false, destructive: false, needsApproval: false },
    closures: { person: [], system: [] },
    handler: () => Effect.void,
  };
  // @ts-expect-error A structural feature has no private builder brand.
  endpoint(forged);
  // @ts-expect-error Ways require builder-created features.
  defineWay({ ...way, features: [forged], endpoints: [] });
  // @ts-expect-error May.fixed takes permissions, not features.
  May.fixed([forged]);
  // @ts-expect-error May.system requires the private feature brand.
  May.system([forged], { system: [], via: "hook" });
  // @ts-expect-error runFeature requires the private feature brand.
  const forgedRun = runFeature(forged, {});
  const app = {} as Composition<never>;
  // @ts-expect-error In-process calls require the private feature brand.
  call(app, forged, {}, {}, { way: "web" });
  // @ts-expect-error Only features may be exposed.
  defineWay({ ...way, features: [operation], endpoints: [] });
  // @ts-expect-error An operation is not an HTTP feature.
  endpoint(operation);
  // @ts-expect-error May accepts permissions, not operation descriptors.
  May.fixed([operation]);
  // @ts-expect-error System exposure also requires a feature.
  May.system([operation], { system: [], via: "hook" });
  // @ts-expect-error Operations cannot start a graph.
  const invalidRun = runFeature(operation, {});
  // @ts-expect-error A feature already has its handler.
  bindOperation(read, () => Effect.void);
  defineFeature("undeclared", {
    ...base,
    // @ts-expect-error Only declared targets may be called.
    handler: (input, { call }) => call(operation, input),
  });
  defineFeature("wrong_output", {
    ...base,
    output: Schema.String,
    // @ts-expect-error A feature cannot return an undeclared success type.
    handler: () => Effect.succeed(1),
  });
  defineFeature("feature_target", {
    ...base,
    // @ts-expect-error Feature edges target operations, never features.
    edges: [read],
    handler: () => Effect.void,
  });
  defineFeature("system_feature_target", {
    ...base,
    // @ts-expect-error System edges cannot target features either.
    edges: [asSystem(read, "background")],
    handler: () => Effect.void,
  });
  // @ts-expect-error A system start needs a reason.
  systemStart("");
  return [invalidRun, forgedRun];
};

it("accepts features at every exposure door and preserves literal lifted flags", () => {
  const http = endpoint(read);
  expect(defineWay({ ...way, features: [read], endpoints: [http] }).features).toEqual([read]);
  expect(
    May.system([system], { system: [], via: "hook" }).pipe(Context.get(CallPermissions)).features,
  ).toEqual([system]);
  expectTypeOf<() => Effect.Effect<void, never, CurrentActor>>().not.toExtend<
    typeof read.handler
  >();
  expectTypeOf(read.readOnly).toEqualTypeOf<true>();
  expectTypeOf(read.flags.readOnly).toEqualTypeOf<true>();
  expectTypeOf(feature.flags.transactional).toEqualTypeOf<false>();
  expectTypeOf(read.transactional).toEqualTypeOf<false>();
  expectTypeOf(read.destructive).toEqualTypeOf<false>();
  expectTypeOf(read.needsApproval).toEqualTypeOf<false>();
  expectTypeOf(feature.transactional).toEqualTypeOf<true>();
  expectTypeOf(feature.destructive).toEqualTypeOf<true>();
  expectTypeOf(feature.needsApproval).toEqualTypeOf<true>();
  expect(feature.closures.person).toEqual(["items:write"]);
  expect(system.start).toEqual({
    kind: "system",
    reason: "hook:first-sign-in",
    startedBy: "hook:first-sign-in",
  });
  expect(typeof negative).toBe("function");
});

it.effect("rejects plain and system feature targets at Runtime and composition acquisition", () =>
  Effect.gen(function* () {
    for (const edge of [read, asSystem(read, "background")]) {
      const root = defineFeature("root_feature", {
        ...base,
        // @ts-expect-error Exercise runtime refusal for JavaScript or erased edge types.
        edges: [edge],
        handler: () => Effect.void,
      });
      const error = yield* Effect.flip(
        Runtime.make({ features: [root, read], bindings: [], ways: [] }),
      );
      expect(error).toBeInstanceOf(GraphInvalid);
      expect(error.reason).toBe("Edge must target an operation: root_feature -> read_feature");
      const app = composition({
        modules: { mounts: [], layer: Layer.merge(StepTrace.layer(), memoryUnitOfWork) },
        features: [root, read],
        ways: [],
        may: Effect.succeed(May.fixed([])),
        system: [],
      });
      yield* Effect.acquireUseRelease(
        Effect.succeed(app),
        (app) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(app.runtime.contextEffect);
            expect(error).toBeInstanceOf(GraphInvalid);
            expect(error.reason).toBe(
              "Edge must target an operation: root_feature -> read_feature",
            );
          }),
        (app) => Effect.promise(() => app.dispose()),
      );
    }
  }),
);

it.effect("rejects an operation edge that hides a feature target", () =>
  Effect.gen(function* () {
    const root = defineOperation("root_operation", { ...base, edges: [read] });
    const error = yield* Runtime.make({
      features: [read],
      bindings: [bindOperation(root, () => Effect.void)],
      ways: [],
    }).pipe(Effect.flip);
    expect(error).toBeInstanceOf(GraphInvalid);
    expect(error.reason).toBe("Edge must target an operation: root_operation -> read_feature");
  }),
);

it.effect("runs a system-start feature without feature bindings", () =>
  runFeature(system, {}).pipe(
    Effect.provide(
      Layer.merge(Runtime.layer({ features: [system], mounts: [], ways: [] }), StepTrace.layer()),
    ),
    Effect.provideContext(May.system([system], { system: [], via: "hook" })),
  ),
);

it.effect("keeps a feature's own read-only promise when validating lifted flags", () =>
  Effect.gen(function* () {
    const invalid = defineFeature("invalid_read", {
      ...base,
      edges: [operation],
      flags: { readOnly: true },
      handler: () => Effect.void,
    });
    const error = yield* Effect.flip(
      Runtime.make({
        features: [invalid],
        bindings: [bindOperation(operation, () => Effect.void)],
        ways: [],
      }),
    );
    expect(error).toBeInstanceOf(GraphInvalid);
    expect(error.reason).toBe("Read-only invalid_read calls write write_operation");
  }),
);
