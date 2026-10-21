import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { assert, expect, it } from "@effect/vitest";
import {
  Actor,
  ActorId,
  asSystem,
  type AnyCallable,
  defineOperation,
  NoInput,
} from "@house-rules/domain";
import { Effect, Option, Schema } from "effect";
import {
  bindOperation,
  CallerContext,
  CurrentActor,
  GraphInvalid,
  May,
  Runtime,
  runFeature,
  StepTrace,
  withRequestId,
} from "../index.ts";

const options = {
  description: "Test",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;
const actor = Actor.make({ id: ActorId.make("ada") });

it.effect(
  "fails acquisition for cycles, unbound callables, duplicate bindings and duplicate exposures",
  () =>
    Effect.gen(function* () {
      const child = defineOperation("child", options);
      const root = defineOperation("root", { ...options, edges: [child] });
      const feature = featureFixture(root);
      const rootBinding = bindOperation(root, () => Effect.void);
      const bindings = [rootBinding, bindOperation(child, () => Effect.void)];
      const childBinding = bindings[1];
      assert.isDefined(childBinding, "Expected a child binding for the duplicate-binding check");
      const edges: AnyCallable[] = [];
      const cyclic: AnyCallable = { ...root, edges };
      edges.push(cyclic);
      for (const config of [
        { bindings: [rootBinding], features: [feature], ways: [] },
        { bindings: [...bindings, childBinding], features: [feature], ways: [] },
        { bindings, features: [feature], ways: [{ name: "bad", features: [feature, feature] }] },
        {
          bindings: [bindOperation({ ...cyclic, kind: "operation" }, () => Effect.void)],
          features: [featureFixture(cyclic)],
          ways: [],
        },
        {
          bindings,
          features: [
            featureFixture(root, {
              start: { kind: "system", reason: " ", startedBy: "hook:test" },
            }),
          ],
          ways: [],
        },
      ]) {
        const error = yield* Effect.flip(RuntimeFixture.make(config));
        expect(error).toBeInstanceOf(GraphInvalid);
        expect(error.kind).toBe("unavailable");
      }
    }),
);

it.effect("inherits the original system caller and removes ambient person authority", () =>
  Effect.gen(function* () {
    const seen: unknown[] = [];
    const leaf = defineOperation("leaf", options);
    const middle = defineOperation("middle", {
      ...options,
      edges: [asSystem(leaf, "later reason")],
    });
    const root = defineOperation("root", { ...options, edges: [asSystem(middle, "first reason")] });
    const feature = featureFixture(root);
    const bindings = [
      bindOperation(root, (_input, scope) => scope.call(middle, {})),
      bindOperation(middle, (_input, scope) => scope.call(leaf, {})),
      bindOperation(leaf, () =>
        Effect.gen(function* () {
          seen.push(yield* CallerContext, yield* Effect.serviceOption(CurrentActor));
        }),
      ),
    ];
    const trace = StepTrace.make();
    yield* runFeature(feature, {}).pipe(
      Effect.provide(RuntimeFixture.layer({ bindings, features: [feature], ways: [] })),
      Effect.provideContext(May.context(May.fixed([feature], []), { system: [], via: "web" })),
      Effect.provideService(StepTrace, trace),
      Effect.provideService(CurrentActor, actor),
      withRequestId("system-switch"),
    );
    expect(seen).toEqual([
      { kind: "system", reason: "first reason", startedBy: "root · ada" },
      Option.none(),
    ]);
    expect((yield* trace.read("system-switch")).steps).toMatchObject([
      {
        order: 1,
        feature: "root",
        target: "middle",
        caller: "system",
        reason: "first reason",
        outcome: "success",
      },
      {
        order: 2,
        feature: "root",
        target: "leaf",
        caller: "system",
        reason: "first reason",
        outcome: "success",
      },
    ]);
  }),
);

it.effect("refuses forged undeclared calls by descriptor identity", () =>
  Effect.gen(function* () {
    const other = defineOperation("other", options);
    const root = defineOperation("root", options);
    const feature = featureFixture(root);
    const bad = bindOperation(root, (_input, scope) => {
      // @ts-expect-error Deliberately forge a call to an undeclared target.
      return scope.call(other, {});
    });
    const error = yield* Effect.flip(
      runFeature(feature, {}).pipe(
        Effect.provide(RuntimeFixture.layer({ bindings: [bad], features: [feature], ways: [] })),
        Effect.provideContext(May.context(May.fixed([feature], []), { system: [], via: "test" })),
        Effect.provide(StepTrace.layer()),
        Effect.provideService(CurrentActor, actor),
      ),
    );
    expect(error._tag).toBe("CallInvalid");
  }),
);
