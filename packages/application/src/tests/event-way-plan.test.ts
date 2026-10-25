import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { appMap, diffMaps, Plan, renderMap, renderMapDiff, validatePlan } from "../index.ts";
import { appForTesting } from "./event-way-fixtures.ts";

it.effect("event plan/map text, HTML, Mermaid, JSON and diff retain kinds and feature", () =>
  Effect.gen(function* () {
    const plan = {
      modules: [],
      features: [
        {
          name: "react",
          permission: null,
          start: { reason: "event reaction", startedBy: "event:react" },
        },
      ],
      ways: [
        { name: "react", protocol: "event", on: ["changed"], features: ["react"], mean: "no" },
      ],
    };
    const snapshot = yield* validatePlan(yield* Schema.decodeUnknownEffect(Plan)(plan));
    const app = appForTesting();
    try {
      const built = yield* appMap(app);
      expect(diffMaps(snapshot, built).empty).toBe(true);
      for (const format of ["text", "html", "mermaid", "json"] as const) {
        expect(renderMap(snapshot, format)).toContain("changed");
        expect(renderMap(snapshot, format)).toContain("react");
      }
      const after = { ...snapshot, ways: snapshot.ways.map((w) => ({ ...w, on: ["other"] })) };
      const diff = diffMaps(snapshot, after);
      expect(diff.empty).toBe(false);
      for (const format of ["text", "html"] as const) {
        expect(renderMapDiff(diff, format)).toContain("changed");
        expect(renderMapDiff(diff, format)).toContain("other");
      }
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
    for (const features of [[], ["react", "react"], ["react", "other"]]) {
      const invalid = yield* Schema.decodeUnknownEffect(Plan)({
        ...plan,
        ways: [{ ...plan.ways[0], features }],
      });
      expect(yield* Effect.flip(validatePlan(invalid))).toMatchObject({ _tag: "PlanInvalid" });
    }
    expect(
      yield* Effect.flip(
        validatePlan(
          yield* Schema.decodeUnknownEffect(Plan)({
            ...plan,
            features: [{ name: "react", permission: null }],
          }),
        ),
      ),
    ).toMatchObject({ _tag: "PlanInvalid" });
    for (const fields of [
      { public: [] },
      { tools: [] },
      { path: "/events" },
      { on: [] },
      { mean: undefined },
    ])
      expect(
        yield* Effect.flip(
          Schema.decodeUnknownEffect(Plan)({ ...plan, ways: [{ ...plan.ways[0], ...fields }] }),
        ),
      ).toBeDefined();
    const withSource = yield* validatePlan(
      yield* Schema.decodeUnknownEffect(Plan)({
        ...plan,
        plugs: [
          { name: "EventLog.source", package: "@house-rules/event-log", fills: "EventSource" },
        ],
      }),
    );
    expect(withSource.plugs).toContainEqual({
      name: "EventLog.source",
      package: "@house-rules/event-log",
      fills: "EventSource",
    });
    expect(
      yield* Effect.flip(
        validatePlan(
          yield* Schema.decodeUnknownEffect(Plan)({
            ...plan,
            plugs: [{ name: "source", fills: "EventSource", ways: ["react"] }],
          }),
        ),
      ),
    ).toMatchObject({ _tag: "PlanInvalid" });
  }),
);
