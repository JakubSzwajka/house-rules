import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { expect, it } from "@effect/vitest";
import {
  Actor,
  ActorId,
  asSystem,
  defineOperation,
  memoryUnitOfWork,
  NoInput,
  UnitOfWork,
} from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  Approval,
  bindOperation,
  CallWatch,
  CurrentActor,
  featureAndRecheck,
  featureOnly,
  Forbidden,
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
const child = defineOperation("child", {
  ...options,
  permission: "items:write",
  transactional: true,
  needsApproval: true,
});
const root = defineOperation("root", { ...options, edges: [child] });
const feature = featureFixture(root);

it.effect("opens one watch, one approval and one unit around the graph, in order", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const unit = yield* Effect.service(UnitOfWork).pipe(Effect.provide(memoryUnitOfWork));
    const bindings = [
      bindOperation(root, (_input, scope) =>
        Effect.sync(() => {
          calls.push("root");
        }).pipe(Effect.andThen(scope.call(child, {}))),
      ),
      bindOperation(child, () =>
        UnitOfWork.required.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              calls.push("child");
            }),
          ),
        ),
      ),
    ];
    yield* runFeature(feature, {}).pipe(
      Effect.provide(RuntimeFixture.layer({ bindings, features: [feature], ways: [] })),
      Effect.provideContext(
        May.context(May.fixed(["items:write"]), { features: [feature], system: [], via: "web" }),
      ),
      Effect.provideService(CurrentActor, actor),
      Effect.provide(StepTrace.layer()),
      Effect.provideService(Approval, {
        approve: () =>
          Effect.sync(() => {
            calls.push("approval");
          }),
      }),
      Effect.provideService(UnitOfWork, {
        atomic: (work) =>
          Effect.sync(() => {
            calls.push("unit");
          }).pipe(Effect.andThen(unit.atomic(work))),
      }),
      Effect.provideService(CallWatch, {
        around: (_feature, _input, work) =>
          Effect.sync(() => {
            calls.push("watch");
          }).pipe(Effect.andThen(work)),
      }),
    );
    expect(calls).toEqual(["watch", "approval", "unit", "root", "child"]);
  }),
);

it.effect("names the real missing permission and caller in either closure", () =>
  Effect.gen(function* () {
    const systemRoot = defineOperation("system_root", {
      ...options,
      edges: [asSystem(child, "background")],
    });
    for (const callable of [root, systemRoot]) {
      const current = featureFixture(callable);
      const trace = StepTrace.make();
      const error = yield* Effect.flip(
        runFeature(current, {}).pipe(
          Effect.provide(
            RuntimeFixture.layer({
              bindings: [
                bindOperation(callable, () => Effect.void),
                bindOperation(child, () => Effect.void),
              ],
              features: [current],
              ways: [],
            }),
          ),
          Effect.provideContext(
            May.context(May.fixed([]), { features: [current], system: [], via: "test" }),
          ),
          Effect.provideService(CurrentActor, actor),
          Effect.provide(Layer.mergeAll(Approval.allowAll, memoryUnitOfWork)),
          Effect.provideService(StepTrace, trace),
          withRequestId("closure-refusal"),
        ),
      );
      expect(yield* trace.read("closure-refusal")).toEqual({
        steps: [],
        refusals: [
          {
            feature: callable.name,
            permission: "items:write",
            caller: callable === root ? "person" : "system",
          },
        ],
      });
      expect(error).toEqual(
        new Forbidden({
          feature: callable.name,
          permission: "items:write",
          caller: callable === root ? "person" : "system",
        }),
      );
    }
  }),
);

for (const gatePolicy of [featureAndRecheck, featureOnly] as const) {
  it.effect(
    `${gatePolicy}: keeps inner rechecks explicit when permissions change after the closure gate`,
    () =>
      Effect.gen(function* () {
        const systemRoot = defineOperation("system_recheck", {
          ...options,
          edges: [asSystem(child, "background")],
        });
        for (const callable of [root, systemRoot]) {
          const current = featureFixture(callable);
          const held: Array<"items:write"> = ["items:write"];
          let ran = false;
          const bindings = [
            bindOperation(callable, (_input, scope) =>
              Effect.sync(() => {
                held.length = 0;
              }).pipe(Effect.andThen(scope.call(child, {}))),
            ),
            bindOperation(child, () =>
              Effect.sync(() => {
                ran = true;
              }),
            ),
          ];
          const outcome = yield* Effect.result(
            runFeature(current, {}).pipe(
              Effect.provide(RuntimeFixture.layer({ bindings, features: [current], ways: [] })),
              Effect.provideContext(
                May.context(May.fixed(held), {
                  features: [current],
                  system: held,
                  via: "test",
                  gatePolicy,
                }),
              ),
              Effect.provideService(CurrentActor, actor),
              Effect.provide(
                Layer.mergeAll(StepTrace.layer(), Approval.allowAll, memoryUnitOfWork),
              ),
            ),
          );
          expect(ran).toBe(gatePolicy === featureOnly);
          expect(outcome._tag).toBe(gatePolicy === featureOnly ? "Success" : "Failure");
          if (outcome._tag === "Failure")
            expect(outcome.failure).toEqual(
              new Forbidden({
                feature: callable.name,
                permission: "items:write",
                caller: callable === root ? "person" : "system",
              }),
            );
        }
      }),
  );
}

it.effect("refuses an feature exposed by another way before approval, unit or callables", () =>
  Effect.gen(function* () {
    const other = featureFixture({ ...root, name: "other" });
    const calls: string[] = [];
    const error = yield* Effect.flip(
      runFeature(feature, {}).pipe(
        Effect.provide(
          RuntimeFixture.layer({
            bindings: [
              bindOperation(root, () =>
                Effect.sync(() => {
                  calls.push("callable");
                }),
              ),
              bindOperation(child, () => Effect.void),
            ],
            features: [feature, other],
            ways: [],
          }),
        ),
        Effect.provideContext(
          May.context(May.fixed(["items:write"]), {
            features: [other],
            system: ["items:write"],
            via: "other",
          }),
        ),
        Effect.provideService(CurrentActor, actor),
        Effect.provide(StepTrace.layer()),
        Effect.provideService(Approval, {
          approve: () =>
            Effect.sync(() => {
              calls.push("approval");
            }),
        }),
        Effect.provide(memoryUnitOfWork),
      ),
    );
    expect(error._tag).toBe("CallInvalid");
    expect(calls).toEqual([]);
  }),
);
