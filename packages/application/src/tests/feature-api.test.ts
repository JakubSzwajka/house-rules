import { expect, expectTypeOf, it } from "@effect/vitest";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain/contract";
import { Context, Effect, Layer, Schema } from "effect";
import { defineFeature, endpoint, systemStart } from "../contract.ts";
import {
  bindOperation,
  call,
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

it.effect("runs feature-to-feature edges and bound operations without feature bindings", () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const leaf = defineOperation("leaf", { ...base, readOnly: true });
    const child = defineFeature("child_feature", {
      ...base,
      edges: [leaf],
      flags: { readOnly: true },
      handler: (input, { call, caller }) => {
        seen.push(caller.kind);
        return call(leaf, input);
      },
    });
    const root = defineFeature("root_feature", {
      ...base,
      edges: [asSystem(child, "background")],
      flags: { readOnly: true },
      handler: (input, { call }) => call(child, input),
    });
    const layer = Layer.merge(
      Layer.effect(
        Runtime,
        Runtime.make({
          features: [root],
          bindings: [bindOperation(leaf, () => Effect.void)],
          ways: [],
        }),
      ),
      StepTrace.layer(),
    );
    yield* runFeature(root, {}).pipe(
      Effect.provide(layer),
      Effect.provideContext(
        May.context(May.fixed([]), { features: [root], system: [], via: "test" }),
      ),
      Effect.provideService(CurrentActor, testActor),
    );
    expect(seen).toEqual(["system"]);
    yield* runFeature(system, {}).pipe(
      Effect.provide(
        Layer.merge(Runtime.layer({ features: [system], mounts: [], ways: [] }), StepTrace.layer()),
      ),
      Effect.provideContext(May.system([system], { system: [], via: "hook" })),
    );
  }),
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
