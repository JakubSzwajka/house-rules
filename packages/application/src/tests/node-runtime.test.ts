import { expect, it } from "@effect/vitest";
import { Actor, ActorId, asSystem, type AnyNode, defineNode, NoInput } from "@house-rules/domain";
import { Effect, Option, Schema } from "effect";
import {
  bindNode,
  CallerContext,
  CurrentActor,
  defineEntry,
  GraphInvalid,
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

it.effect(
  "fails acquisition for cycles, unbound nodes, duplicate bindings and duplicate exposures",
  () =>
    Effect.gen(function* () {
      const child = defineNode("child", options);
      const root = defineNode("root", { ...options, edges: [child] });
      const entry = defineEntry(root);
      const rootBinding = bindNode(root, () => Effect.void);
      const bindings = [rootBinding, bindNode(child, () => Effect.void)];
      const edges: AnyNode[] = [];
      const cyclic: AnyNode = { ...root, edges };
      edges.push(cyclic);
      for (const config of [
        { bindings: [rootBinding], entries: [entry], ways: [] },
        { bindings: [...bindings, rootBinding], entries: [entry], ways: [] },
        { bindings, entries: [entry], ways: [{ name: "bad", entries: [entry, entry] }] },
        {
          bindings: [bindNode(cyclic, () => Effect.void)],
          entries: [defineEntry(cyclic)],
          ways: [],
        },
        {
          bindings,
          entries: [
            defineEntry(root, { start: { kind: "system", reason: " ", startedBy: "hook:test" } }),
          ],
          ways: [],
        },
      ]) {
        const error = yield* Effect.flip(NodeRuntime.make(config));
        expect(error).toBeInstanceOf(GraphInvalid);
        expect(error.kind).toBe("unavailable");
      }
    }),
);

it.effect("inherits the original system caller and removes ambient person authority", () =>
  Effect.gen(function* () {
    const seen: unknown[] = [];
    const leaf = defineNode("leaf", options);
    const middle = defineNode("middle", { ...options, edges: [asSystem(leaf, "later reason")] });
    const root = defineNode("root", { ...options, edges: [asSystem(middle, "first reason")] });
    const entry = defineEntry(root);
    const bindings = [
      bindNode(root, (_input, scope) => scope.call(middle, {})),
      bindNode(middle, (_input, scope) => scope.call(leaf, {})),
      bindNode(leaf, () =>
        Effect.gen(function* () {
          seen.push(yield* CallerContext, yield* Effect.serviceOption(CurrentActor));
        }),
      ),
    ];
    const trace = StepTrace.make();
    yield* runEntry(entry, {}).pipe(
      Effect.provide(NodeRuntime.layer({ bindings, entries: [entry], ways: [] })),
      Effect.provideContext(May.context(May.fixed([entry], []), { system: [], via: "web" })),
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
        entry: "root",
        target: "middle",
        caller: "system",
        reason: "first reason",
        outcome: "success",
      },
      {
        order: 2,
        entry: "root",
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
    const other = defineNode("other", options);
    const root = defineNode("root", options);
    const entry = defineEntry(root);
    const bad = bindNode(root, (_input, scope) => {
      // @ts-expect-error Deliberately forge a call to an undeclared target.
      return scope.call(other, {});
    });
    const error = yield* Effect.flip(
      runEntry(entry, {}).pipe(
        Effect.provide(NodeRuntime.layer({ bindings: [bad], entries: [entry], ways: [] })),
        Effect.provideContext(May.context(May.fixed([entry], []), { system: [], via: "test" })),
        Effect.provide(StepTrace.layer()),
        Effect.provideService(CurrentActor, actor),
      ),
    );
    expect(error._tag).toBe("NodeCallInvalid");
  }),
);
