import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { Plan, renderMap, validatePlan } from "@house-rules/application";
import { mapSnapshot } from "../../scripts/map.ts";

it.effect("plan.json derives the same map as the built booking app", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(new URL("../../plan.json", import.meta.url).pathname);
    const plan = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Plan))(text);
    const planned = yield* validatePlan(plan);
    const actual = yield* mapSnapshot;
    for (const format of ["json", "text", "mermaid"] as const)
      assert.strictEqual(renderMap(planned, format), renderMap(actual, format));
  }).pipe(Effect.provide(NodeServices.layer)),
);
