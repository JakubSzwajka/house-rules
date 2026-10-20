import { expect, it } from "@effect/vitest";
import {
  Actor,
  ActorId,
  asSystem,
  defineNode,
  memoryUnitOfWork,
  NoInput,
  UnitOfWork,
} from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  Approval,
  bindNode,
  CallWatch,
  CurrentActor,
  defineEntry,
  entryAndRecheck,
  entryOnly,
  Forbidden,
  May,
  NodeRuntime,
  runEntry,
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
const child = defineNode("child", {
  ...options,
  permission: "items:write",
  transactional: true,
  needsApproval: true,
});
const root = defineNode("root", { ...options, edges: [child] });
const entry = defineEntry(root);

it.effect("opens one watch, one approval and one unit around the graph, in order", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const unit = yield* Effect.service(UnitOfWork).pipe(Effect.provide(memoryUnitOfWork));
    const bindings = [
      bindNode(root, (_input, scope) =>
        Effect.sync(() => {
          calls.push("root");
        }).pipe(Effect.andThen(scope.call(child, {}))),
      ),
      bindNode(child, () =>
        UnitOfWork.required.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              calls.push("child");
            }),
          ),
        ),
      ),
    ];
    yield* runEntry(entry, {}).pipe(
      Effect.provide(NodeRuntime.layer({ bindings, entries: [entry], ways: [] })),
      Effect.provideContext(
        May.context(May.fixed([entry], ["items:write"]), { system: [], via: "web" }),
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
        around: (_entry, _input, work) =>
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
    const systemRoot = defineNode("system_root", {
      ...options,
      edges: [asSystem(child, "background")],
    });
    for (const node of [root, systemRoot]) {
      const current = defineEntry(node);
      const trace = StepTrace.make();
      const error = yield* Effect.flip(
        runEntry(current, {}).pipe(
          Effect.provide(
            NodeRuntime.layer({
              bindings: [bindNode(node, () => Effect.void), bindNode(child, () => Effect.void)],
              entries: [current],
              ways: [],
            }),
          ),
          Effect.provideContext(May.context(May.fixed([current], []), { system: [], via: "test" })),
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
            entry: node.name,
            permission: "items:write",
            caller: node === root ? "person" : "system",
          },
        ],
      });
      expect(error).toEqual(
        new Forbidden({
          entry: node.name,
          permission: "items:write",
          caller: node === root ? "person" : "system",
        }),
      );
    }
  }),
);

for (const gatePolicy of [entryAndRecheck, entryOnly] as const) {
  it.effect(`${gatePolicy}: keeps the forged closure backstop policy explicit`, () =>
    Effect.gen(function* () {
      const systemRoot = defineNode("system_recheck", {
        ...options,
        edges: [asSystem(child, "background")],
      });
      for (const node of [root, systemRoot]) {
        const forged = { ...defineEntry(node), closures: { person: [], system: [] } };
        let ran = false;
        const bindings = [
          bindNode(node, (_input, scope) => scope.call(child, {})),
          bindNode(child, () =>
            Effect.sync(() => {
              ran = true;
            }),
          ),
        ];
        const outcome = yield* Effect.result(
          runEntry(forged, {}).pipe(
            Effect.provide(NodeRuntime.layer({ bindings, entries: [forged], ways: [] })),
            Effect.provideContext(
              May.context(May.fixed([forged], []), { system: [], via: "test", gatePolicy }),
            ),
            Effect.provideService(CurrentActor, actor),
            Effect.provide(Layer.mergeAll(StepTrace.layer(), Approval.allowAll, memoryUnitOfWork)),
          ),
        );
        expect(ran).toBe(gatePolicy === entryOnly);
        expect(outcome._tag).toBe(gatePolicy === entryOnly ? "Success" : "Failure");
        if (outcome._tag === "Failure")
          expect(outcome.failure).toEqual(
            new Forbidden({
              entry: node.name,
              permission: "items:write",
              caller: node === root ? "person" : "system",
            }),
          );
      }
    }),
  );
}

it.effect("refuses an entry exposed by another way before approval, unit or nodes", () =>
  Effect.gen(function* () {
    const other = defineEntry(root);
    const calls: string[] = [];
    const error = yield* Effect.flip(
      runEntry(entry, {}).pipe(
        Effect.provide(
          NodeRuntime.layer({
            bindings: [
              bindNode(root, () =>
                Effect.sync(() => {
                  calls.push("node");
                }),
              ),
              bindNode(child, () => Effect.void),
            ],
            entries: [entry, other],
            ways: [],
          }),
        ),
        Effect.provideContext(
          May.context(May.fixed([other], ["items:write"]), {
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
    expect(error._tag).toBe("NodeCallInvalid");
    expect(calls).toEqual([]);
  }),
);
