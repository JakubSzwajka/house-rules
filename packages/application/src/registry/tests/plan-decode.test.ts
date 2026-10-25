import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Plan } from "../../index.ts";
import { plan } from "./plan-fixtures.ts";

it.effect("Plan rejects excess keys at every nested object with an issue path", () =>
  Effect.gen(function* () {
    const input = {
      ...plan,
      layers: "snapshot",
      modules: plan.modules.map((module) => ({
        ...module,
        extra: true,
        operations: module.operations.map((op) => ({ ...op, flags: { readOnly: true } })),
      })),
      features: plan.features.map((feature) => ({
        ...feature,
        flags: { readOnly: true },
        closures: { person: [] },
        start: { reason: "r", startedBy: "s", kind: "system" },
        edges: [{ target: "Views.list", reason: "r", kind: "operation" }],
      })),
      ways: [
        { name: "w", protocol: "http", path: "/api", features: [], extra: true },
        {
          name: "s",
          protocol: "schedule",
          features: [],
          clock: { cron: "c", timeZone: "UTC", extra: true },
        },
      ],
      plugs: [{ name: "p", fills: "May", extra: true }],
    };
    const error = yield* Schema.decodeUnknownEffect(Plan)(input, { errors: "all" }).pipe(
      Effect.flip,
    );
    for (const path of [
      '["layers"]',
      '["modules"][0]["extra"]',
      '["modules"][0]["operations"][0]["flags"]',
      '["features"][0]["flags"]',
      '["features"][0]["closures"]',
      '["features"][0]["start"]["kind"]',
      '["features"][0]["edges"][0]["kind"]',
      '["ways"][0]["extra"]',
      '["ways"][1]["clock"]["extra"]',
      '["plugs"][0]["extra"]',
    ])
      expect(error.message).toContain(path);
  }),
);

it.effect("strict Plan decoding also applies through JSON strings", () =>
  Effect.gen(function* () {
    const error = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Plan))(
      JSON.stringify({ ...plan, permissions: [] }),
    ).pipe(Effect.flip);
    expect(error.message).toContain('["permissions"]');
    expect(yield* Schema.decodeUnknownEffect(Plan)(plan)).toEqual(plan);
  }),
);
