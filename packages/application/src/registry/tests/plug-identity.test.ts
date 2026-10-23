import { expect, it } from "@effect/vitest";
import { memoryUnitOfWork, NoInput } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import {
  appMap,
  composition,
  defineFeature,
  defineWay,
  May,
  Mean,
  type Plan,
  StepTrace,
  systemStart,
  validatePlan,
} from "../../index.ts";

class MeanSlot extends Context.Service<MeanSlot, (event: unknown) => Effect.Effect<void>>()(
  "Mean",
) {}

const job = defineFeature("job", {
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  description: "Job",
  permission: null,
  start: systemStart("test"),
  handler: () => Effect.void,
});

const hookWay = defineWay({
  name: "h",
  protocol: "hook",
  slot: MeanSlot,
  features: [job],
  mean: Mean.allow,
  input: () => ({}),
  failure: () => undefined,
});

const planJob = { name: "job", permission: null, start: { reason: "r", startedBy: "r" } } as const;

const issuesOf = (value: Plan) =>
  validatePlan(value).pipe(
    Effect.flip,
    Effect.map((error) => error.issues),
  );

it.effect("a hook slot keyed Mean runs and maps beside the Mean socket", () =>
  Effect.gen(function* () {
    const app = composition({
      modules: { mounts: [], layer: Layer.merge(StepTrace.layer(), memoryUnitOfWork) },
      features: [job],
      ways: [hookWay],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    const snapshot = yield* Effect.gen(function* () {
      const context = yield* app.runtime.contextEffect;
      yield* Context.get(context, MeanSlot)({});
      return yield* appMap(app);
    }).pipe(Effect.ensuring(Effect.promise(app.dispose)));
    expect((snapshot.plugs ?? []).map(({ name, fills, ways }) => [name, fills, ways])).toEqual([
      ["Mean.allow", "Mean", ["h"]],
      ["hook:h", "Mean", ["h"]],
    ]);
  }),
);

it.effect("a plan hook slot keyed Mean validates, alone or with declared twins", () =>
  Effect.gen(function* () {
    const ways = [
      { name: "h", protocol: "hook", slot: "Mean", mean: "allow", features: ["job"] },
    ] as const;
    const bare = yield* validatePlan({ modules: [], features: [planJob], ways });
    const declared = yield* validatePlan({
      modules: [],
      features: [planJob],
      ways,
      plugs: [
        { name: "hook:h", fills: "Mean", ways: ["h"] },
        { name: "Mean.allow", package: "@house-rules/application", fills: "Mean", ways: ["h"] },
      ],
    });
    expect(declared.plugs).toEqual(bare.plugs);
    expect((bare.plugs ?? []).map(({ name }) => name)).toEqual(["Mean.allow", "hook:h"]);
  }),
);

it.effect("slot keys named after sockets keep slot rules and socket fills keep socket rules", () =>
  Effect.gen(function* () {
    const ways = [
      { name: "web", protocol: "http", path: "/api", features: ["job"] },
      { name: "h", protocol: "hook", slot: "Who", features: ["job"] },
      { name: "g", protocol: "hook", slot: "May", features: ["job"] },
    ] as const;
    // Derived hook twins on slots named Who and May pass; Who and May socket rules do not apply.
    yield* validatePlan({
      modules: [],
      features: [planJob],
      ways,
      plugs: [
        { name: "hook:h", fills: "Who", ways: ["h"] },
        { name: "hook:g", fills: "May", ways: ["g"] },
        { name: "app.may", fills: "May" },
        { name: "app.who", fills: "Who", ways: ["web"] },
      ],
    });
    // A declared plug that is no twin fills the socket, so Who stays off hook ways.
    expect(
      yield* issuesOf({
        modules: [],
        features: [planJob],
        ways,
        plugs: [
          { name: "my.who", fills: "Who", ways: ["h"] },
          { name: "hook:x", fills: "Who", ways: ["web"] },
        ],
      }),
    ).toEqual([
      {
        path: "plugs[0].ways[0]",
        reason: "my.who fills Who on h, which is not an HTTP or MCP way",
      },
      {
        path: "plugs[1].name",
        reason: "hook:x uses the hook: prefix, which only hook ways derive",
      },
    ]);
  }),
);

it.effect("double fills are reported beside other plug issues", () =>
  Effect.gen(function* () {
    expect(
      yield* issuesOf({
        modules: [],
        features: [planJob],
        ways: [{ name: "web", protocol: "http", path: "/api", features: ["job"] }],
        plugs: [
          { name: "p.may", fills: "May" },
          { name: "q.may", fills: "May" },
          { name: "c", fills: "Gravity" },
        ],
      }),
    ).toEqual([
      {
        path: "plugs[2].fills",
        reason: "c fills Gravity, which is no socket, port or hook way slot",
      },
      { path: "plugs[1]", reason: "p.may and q.may both fill May" },
    ]);
  }),
);
