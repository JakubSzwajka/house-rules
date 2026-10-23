import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Plan, validatePlan } from "../../index.ts";

const issuesOf = (value: Plan) =>
  validatePlan(value).pipe(
    Effect.flip,
    Effect.map((error) => error.issues),
  );

it.effect("cheap plan issues are collected in one pass with paths", () =>
  Effect.gen(function* () {
    const store = {
      name: "store",
      service: "test/plan/Store",
      kind: "package",
      operations: [
        { name: "Store.audit", permission: "audit:write" },
        { name: "Store.save", permission: "items:write" },
      ],
    } as const;
    const error = yield* validatePlan({
      modules: [store, { ...store, name: "views", operations: [] }],
      features: [
        { name: "a", permission: null, edges: ["missing", { target: "Store.save", reason: " " }] },
        { name: "a", permission: null },
        { name: "Store.audit", permission: null },
        { name: "job", permission: null, start: { reason: "", startedBy: "x" } },
      ],
      ways: [
        {
          name: "w",
          protocol: "http",
          path: "/w",
          features: ["a", "Store.save"],
          public: ["a", "job"],
        },
        { name: "w", protocol: "mcp", path: "/m", features: ["a"], public: ["a"] },
      ],
    }).pipe(Effect.flip);
    expect(error._tag).toBe("PlanInvalid");
    expect(error.kind).toBe("invalid");
    expect(error.issues).toEqual([
      {
        path: "modules[1].service",
        reason: "Duplicate mount service test/plan/Store (also modules[0])",
      },
      { path: "features[1].name", reason: "Duplicate callable name a (also features[0])" },
      {
        path: "features[2].name",
        reason: "Duplicate callable name Store.audit (also modules[0].operations[0])",
      },
      { path: "features[0].edges[0]", reason: "Unresolved edge target missing at a" },
      { path: "features[0].edges[1].reason", reason: "Blank system reason at a" },
      { path: "features[3].start", reason: "Blank system feature reason or startedBy at job" },
      { path: "ways[0].features[1]", reason: "w exposes Store.save, which is not a plan feature" },
      { path: "ways[0].public[0]", reason: "Public feature a must declare a system start" },
      { path: "ways[0].public[1]", reason: "Public feature job must be exposed by w" },
      { path: "ways[1].name", reason: "Duplicate way name w (also ways[0])" },
      { path: "ways[1].public", reason: "MCP ways cannot expose public features" },
      { path: "ways[1].public[0]", reason: "Public feature a must declare a system start" },
    ]);
    expect(error.message).toBe(
      "Plan has 12 issues; first: Duplicate mount service test/plan/Store (also modules[0])",
    );
  }),
);

it.effect("builder and runtime checks surface as one issue", () =>
  Effect.gen(function* () {
    const only = (features: Plan["features"], ways: Plan["ways"] = []): Plan => ({
      modules: [],
      features,
      ways,
    });
    expect(
      yield* issuesOf(
        only([
          { name: "a", permission: null, edges: ["b"] },
          { name: "b", permission: null, edges: ["a"] },
        ]),
      ),
    ).toEqual([{ path: "features[0]", reason: "Cycle at a" }]);
    expect(
      yield* issuesOf(
        only([
          { name: "read", permission: null, readOnly: true, edges: ["write"] },
          { name: "write", permission: null },
        ]),
      ),
    ).toEqual([{ path: "plan", reason: "Read-only read calls write write" }]);
    expect(
      yield* issuesOf(
        only(
          [{ name: "a", permission: null }],
          [{ name: "h", protocol: "hook", slot: "s", features: ["a"] }],
        ),
      ),
    ).toEqual([{ path: "plan", reason: "System ways require system-start features" }]);
    const job = { name: "job", permission: null, start: { reason: "r", startedBy: "r" } } as const;
    expect(
      yield* issuesOf(
        only(
          [job, { ...job, name: "job2" }],
          [{ name: "h", protocol: "hook", slot: "s", features: ["job", "job2"] }],
        ),
      ),
    ).toEqual([{ path: "plan", reason: "h: hooks require one feature" }]);
    expect(
      yield* issuesOf(
        only([job], [{ name: "w", protocol: "http", path: "api", features: ["job"] }]),
      ),
    ).toEqual([{ path: "plan", reason: "Invalid way path api" }]);
    expect(
      yield* issuesOf(
        only(
          [job],
          [
            { name: "w", protocol: "http", path: "/api", features: ["job"] },
            { name: "v", protocol: "mcp", path: "/API", features: ["job"] },
          ],
        ),
      ),
    ).toEqual([{ path: "plan", reason: "Duplicate way path /API" }]);
  }),
);

it.effect("a duplicate entry still reports its own start, edge and reason issues", () =>
  Effect.gen(function* () {
    expect(
      yield* issuesOf({
        modules: [],
        features: [
          { name: "same", permission: null },
          {
            name: "same",
            permission: null,
            start: { reason: "", startedBy: "" },
            edges: ["missing", { target: "same", reason: "" }],
          },
        ],
        ways: [],
      }),
    ).toEqual([
      { path: "features[1].name", reason: "Duplicate callable name same (also features[0])" },
      { path: "features[1].start", reason: "Blank system feature reason or startedBy at same" },
      { path: "features[1].edges[0]", reason: "Unresolved edge target missing at same" },
      { path: "features[1].edges[1].reason", reason: "Blank system reason at same" },
    ]);
  }),
);

it.effect("stub endpoints add no route constraints the plan does not contain", () =>
  Effect.gen(function* () {
    const read = { permission: null, readOnly: true } as const;
    const job = { permission: null, start: { reason: "r", startedBy: "r" } } as const;
    const snapshot = yield* validatePlan({
      modules: [],
      features: [
        { name: "Report", ...read },
        { name: "report", ...read },
        { name: "mcp", ...job },
        { name: "odd name", ...read },
      ],
      ways: [
        { name: "web", protocol: "http", path: "/api", features: ["Report", "report"] },
        { name: "root", protocol: "http", path: "/", features: ["mcp", "odd name"] },
        { name: "agent", protocol: "mcp", path: "/mcp", features: ["Report"] },
      ],
    });
    expect(snapshot.ways.map((way) => way.name)).toEqual(["agent", "root", "web"]);
  }),
);

it.effect("ways at the empty and root prefixes get distinct stub endpoints", () =>
  Effect.gen(function* () {
    const read = { permission: null, readOnly: true } as const;
    const snapshot = yield* validatePlan({
      modules: [],
      features: [
        { name: "a", ...read },
        { name: "b", ...read },
      ],
      ways: [
        { name: "empty", protocol: "http", path: "", features: ["a"] },
        { name: "root", protocol: "http", path: "/", features: ["b"] },
      ],
    });
    expect(snapshot.ways.map((way) => way.name)).toEqual(["empty", "root"]);
  }),
);

it.effect("module source paths follow the unique service, not the display name", () =>
  Effect.gen(function* () {
    const snapshot = yield* validatePlan({
      modules: [
        {
          name: "store",
          service: "test/One",
          kind: "package",
          path: "packages/one",
          operations: [{ name: "One.read", permission: "one:read", readOnly: true }],
        },
        {
          name: "store",
          service: "test/Two",
          kind: "package",
          path: "packages/two",
          operations: [{ name: "Two.read", permission: "two:read", readOnly: true }],
        },
      ],
      features: [],
      ways: [],
    });
    expect(snapshot.modules.map(({ service, path }) => ({ service, path }))).toEqual([
      { service: "test/One", path: "packages/one" },
      { service: "test/Two", path: "packages/two" },
    ]);
  }),
);
