import { expect, it } from "@effect/vitest";
import { asSystem, defineNode, memoryUnitOfWork, NoInput, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  admit,
  bindNode,
  call,
  CallerContext,
  composition,
  defineEntry,
  defineWay,
  endpoint,
  May,
  Mean,
  NodeRuntime,
  runEntry,
  StepTrace,
} from "../index.ts";
import { bindFixture, testActor } from "./entry-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
const base = {
  description: "Test an entry.",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;
it("entry flags lift every reachable descriptor, not just the root", () => {
  const child = defineNode("child", {
    ...base,
    transactional: true,
    needsApproval: true,
    destructive: true,
  });
  const root = defineNode("root", { ...base, edges: [child] });
  expect(defineEntry(root)).toMatchObject({
    transactional: true,
    needsApproval: true,
    destructive: true,
    readOnly: false,
  });
  const read = defineNode("read", { ...base, readOnly: true });
  expect(defineEntry(read)).toMatchObject({
    transactional: false,
    needsApproval: false,
    destructive: false,
    readOnly: true,
  });
});
it.effect(
  "a system entry needs no ambient person and preserves its reason through every edge",
  () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const leaf = defineNode("leaf", { ...base, permission: "items:write", transactional: true });
      const root = defineNode("root", {
        ...base,
        edges: [asSystem(leaf, "ignored descendant reason")],
      });
      const entry = defineEntry(root, {
        start: { kind: "system", reason: "nightly", startedBy: "schedule:cleanup" },
      });
      const bindings = [
        bindNode(root, (_input, scope) => scope.call(leaf, {})),
        bindNode(leaf, () =>
          Effect.gen(function* () {
            yield* UnitOfWork.required;
            seen.push(yield* CallerContext);
          }),
        ),
      ];
      yield* runEntry(entry, {}).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeRuntime.layer({ bindings, entries: [entry], ways: [] }),
            StepTrace.layer(),
            memoryUnitOfWork,
          ),
        ),
        Effect.provideContext(
          May.context(May.system([entry]), { system: ["items:write"], via: "schedule" }),
        ),
      );
      expect(seen).toEqual([{ kind: "system", reason: "nightly", startedBy: "schedule:cleanup" }]);
    }),
);
it.effect("in-process calls validate decoded input types without lossy re-encoding", () =>
  Effect.gen(function* () {
    const input = Schema.Struct({
      value: Schema.FiniteFromString.pipe(
        Schema.withDecodingDefaultKey(Effect.succeed("42"), { encodingStrategy: "omit" }),
      ),
    });
    const entry = bindFixture(
      defineEntry(
        defineNode("typed_input", {
          description: "Keep decoded input.",
          input,
          output: Schema.Finite,
          failure: Schema.Never,
          permission: null,
          readOnly: true,
        }),
      ),
      ({ value }) => Effect.succeed(value),
    );
    const fixture = httpFixture([entry], { endpoints: [endpoint(entry)] });
    const incoming = { headers: new Headers(), url: "/" };
    expect(
      yield* Effect.promise(() =>
        call(fixture.app, entry, { value: 12 }, incoming, { way: "web" }),
      ),
    ).toEqual({ ok: true, value: 12 });
    const invalid = yield* Effect.promise(() =>
      call(fixture.app, entry, { value: "12" as unknown as number }, incoming, { way: "web" }),
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { _tag: "InputInvalid", entry: "typed_input", field: "value" },
    });
    yield* Effect.promise(fixture.dispose);
  }),
);
it.effect(
  "composition revalidates its actual entries against the acquired runtime's bindings",
  () =>
    Effect.gen(function* () {
      const bound = defineNode("bound", base);
      const unbound = defineNode("unbound", base);
      const initial = defineEntry(bound);
      const actual = defineEntry(unbound);
      let callers = 0;
      const way = defineWay({
        name: "web",
        path: "/",
        protocol: "http",
        entries: [actual],
        endpoints: [endpoint(actual)],
        who: {
          resolve: () =>
            Effect.sync(() => {
              callers += 1;
              return testActor;
            }),
        },
        may: May.fixed([actual], []),
        mean: Mean.no,
      });
      const app = composition({
        layer: Layer.merge(
          NodeRuntime.layer({
            bindings: [bindNode(bound, () => Effect.void)],
            entries: [initial],
            ways: [],
          }),
          StepTrace.layer(),
        ),
        entries: [actual],
        ways: [way],
        system: [],
      });
      const result = yield* Effect.promise(() =>
        admit(app, { headers: new Headers(), url: "/" }, { way: "web" }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "GraphInvalid", reason: "Node has no binding: unbound" },
      });
      expect(callers).toBe(0);
      yield* Effect.promise(app.dispose);
    }),
);
