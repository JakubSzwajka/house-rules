import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { StepTrace } from "../index.ts";
const step = { feature: "web", target: "read", caller: "person", reason: null } as const;

it.effect("evicts oldest-created buckets, not least-recently-read", () =>
  Effect.gen(function* () {
    const trace = StepTrace.make({ maxRequests: 2 });
    yield* trace.begin("a", step);
    yield* trace.begin("b", step);
    yield* trace.read("a");
    yield* trace.begin("c", step);
    expect((yield* trace.read("a")).steps).toEqual([]);
    expect((yield* trace.read("b")).steps).toHaveLength(1);
    expect((yield* trace.read("c")).steps).toHaveLength(1);
  }),
);
it.effect("unknown reads and evicted finishes never allocate or evict", () =>
  Effect.gen(function* () {
    const trace = StepTrace.make({ maxRequests: 1 });
    yield* trace.begin("a", step);
    yield* trace.read("unknown");
    yield* trace.finish("unknown", 1, "failure");
    expect((yield* trace.read("a")).steps).toHaveLength(1);
    yield* trace.begin("b", step);
    yield* trace.finish("a", 1, "success");
    expect((yield* trace.read("a")).steps).toEqual([]);
    expect((yield* trace.read("b")).steps).toHaveLength(1);
  }),
);
it.effect("copies snapshots, keeps feature names, unique orders and the null fallback", () =>
  Effect.gen(function* () {
    const trace = StepTrace.make();
    const first = yield* trace.begin(null, { ...step, feature: "hook" });
    const second = yield* trace.begin(null, step);
    yield* trace.finish(null, first, "success");
    yield* trace.finish(null, second, "failure");
    const snapshot = yield* trace.read(null);
    expect(snapshot.steps).toMatchObject([
      { order: 1, feature: "hook", outcome: "success" },
      { order: 2, feature: "web", outcome: "failure" },
    ]);
    (snapshot.steps as unknown[]).length = 0;
    expect((yield* trace.read(null)).steps).toHaveLength(2);
  }),
);
it.effect("bounds refusal-only requests and defaults to 1000 buckets", () =>
  Effect.gen(function* () {
    const trace = StepTrace.make();
    for (let i = 0; i <= 1000; i += 1)
      yield* trace.refuse(String(i), {
        feature: "read",
        permission: "items:read",
        caller: "person",
      });
    expect((yield* trace.read("0")).refusals).toEqual([]);
    expect((yield* trace.read("1")).refusals).toHaveLength(1);
  }),
);
it("make and layer reject invalid retention bounds synchronously at wiring time", () => {
  for (const maxRequests of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => StepTrace.make({ maxRequests })).toThrow(RangeError);
    expect(() => StepTrace.layer({ maxRequests })).toThrow(RangeError);
  }
});

it.effect("valid layers allocate fresh trace state lazily per build", () => {
  let reads = 0;
  const layer = StepTrace.layer({
    get maxRequests() {
      reads += 1;
      return 1;
    },
  });
  expect(reads).toBe(1);
  const use = Effect.gen(function* () {
    const trace = yield* StepTrace;
    expect((yield* trace.read("a")).steps).toEqual([]);
    expect((yield* trace.read("b")).steps).toEqual([]);
    yield* trace.begin("a", step);
    yield* trace.begin("b", step);
    expect((yield* trace.read("a")).steps).toEqual([]);
    expect((yield* trace.read("b")).steps).toHaveLength(1);
  });
  return Effect.gen(function* () {
    yield* use.pipe(Effect.provide(layer));
    yield* use.pipe(Effect.provide(layer));
    expect(reads).toBe(1);
  });
});

it.effect("the default layer shares make's 1000-bucket bound", () =>
  Effect.gen(function* () {
    const trace = yield* StepTrace;
    for (let i = 0; i <= 1000; i += 1) yield* trace.begin(String(i), step);
    expect((yield* trace.read("0")).steps).toEqual([]);
    expect((yield* trace.read("1")).steps).toHaveLength(1);
  }).pipe(Effect.provide(StepTrace.layer())),
);
