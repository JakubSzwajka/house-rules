import { featureFixture, RuntimeFixture } from "./feature-fixtures.ts";
import { expect, it } from "@effect/vitest";
import {
  asSystem,
  defineOperation,
  memoryUnitOfWork,
  NoInput,
  UnitOfWork,
} from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  admit,
  bindOperation,
  call,
  CallerContext,
  composition,
  defineWay,
  endpoint,
  May,
  Mean,
  Runtime,
  runFeature,
  StepTrace,
} from "../index.ts";
import { bindFixture, testActor } from "./execution-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
const base = {
  description: "Test an feature.",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;
it("feature flags lift every reachable descriptor, not just the root", () => {
  const child = defineOperation("child", {
    ...base,
    transactional: true,
    needsApproval: true,
    destructive: true,
  });
  const root = defineOperation("root", { ...base, edges: [child] });
  expect(featureFixture(root)).toMatchObject({
    transactional: true,
    needsApproval: true,
    destructive: true,
    readOnly: false,
  });
  const read = defineOperation("read", { ...base, readOnly: true });
  expect(featureFixture(read)).toMatchObject({
    transactional: false,
    needsApproval: false,
    destructive: false,
    readOnly: true,
  });
});
it.effect(
  "a system feature needs no ambient person and preserves its reason through every edge",
  () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const leaf = defineOperation("leaf", {
        ...base,
        permission: "items:write",
        transactional: true,
      });
      const root = defineOperation("root", {
        ...base,
        edges: [asSystem(leaf, "ignored descendant reason")],
      });
      const feature = featureFixture(root, {
        start: { kind: "system", reason: "nightly", startedBy: "schedule:cleanup" },
      });
      const bindings = [
        bindOperation(root, (_input, scope) => scope.call(leaf, {})),
        bindOperation(leaf, () =>
          Effect.gen(function* () {
            yield* UnitOfWork.required;
            seen.push(yield* CallerContext);
          }),
        ),
      ];
      yield* runFeature(feature, {}).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFixture.layer({ bindings, features: [feature], ways: [] }),
            StepTrace.layer(),
            memoryUnitOfWork,
          ),
        ),
        Effect.provideContext(May.system([feature], { system: ["items:write"], via: "schedule" })),
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
    const feature = bindFixture(
      featureFixture(
        defineOperation("typed_input", {
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
    const fixture = httpFixture([feature], { endpoints: [endpoint(feature)] });
    const incoming = { headers: new Headers(), url: "/" };
    expect(
      yield* Effect.promise(() =>
        call(fixture.app, feature, { value: 12 }, incoming, { way: "web" }),
      ),
    ).toEqual({ ok: true, value: 12 });
    const invalid = yield* Effect.promise(() =>
      call(fixture.app, feature, { value: "12" as unknown as number }, incoming, { way: "web" }),
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { _tag: "InputInvalid", feature: "typed_input", field: "value" },
    });
    yield* Effect.promise(fixture.dispose);
  }),
);
it.effect(
  "composition revalidates its actual features against the acquired runtime's bindings",
  () =>
    Effect.gen(function* () {
      const bound = defineOperation("bound", base);
      const unbound = defineOperation("unbound", base);
      const initial = featureFixture(bound);
      const actual = featureFixture(defineOperation("actual", { ...base, edges: [unbound] }));
      let callers = 0;
      const way = defineWay({
        name: "web",
        path: "/",
        protocol: "http",
        features: [actual],
        endpoints: [endpoint(actual)],
        who: {
          resolve: () =>
            Effect.sync(() => {
              callers += 1;
              return testActor;
            }),
        },
        mean: Mean.no,
      });
      const app = composition({
        layer: Layer.merge(
          RuntimeFixture.layer({
            bindings: [bindOperation(bound, () => Effect.void)],
            features: [initial],
            ways: [],
          }),
          StepTrace.layer(),
        ),
        features: [actual],
        ways: [way],
        may: May.fixed([]),
        system: [],
      });
      const result = yield* Effect.promise(() =>
        admit(app, { headers: new Headers(), url: "/" }, { way: "web" }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "GraphInvalid", reason: "Operation has no binding: unbound" },
      });
      expect(callers).toBe(0);
      yield* Effect.promise(app.dispose);
    }),
);
