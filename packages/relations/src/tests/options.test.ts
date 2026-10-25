import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  Relations,
  RelationsInputInvalid,
  RelationsOptions,
  RelationsStoreUnavailable,
} from "../index.js";
const type = {
  name: "link",
  source: ["item"],
  target: ["item"],
  directed: true,
  acyclic: true,
  unique: true,
};
const options: RelationsOptions = {
  nodeKinds: ["item"],
  relationTypes: [type],
  maxPageSize: 10,
  maxGraphSize: 10,
};
it.effect("rejects inconsistent configs during layer acquisition", () =>
  Effect.gen(function* () {
    for (const invalid of [
      { ...options, nodeKinds: ["item", "item"] },
      { ...options, relationTypes: [type, type] },
      { ...options, relationTypes: [{ ...type, source: ["unknown"] }] },
      { ...options, relationTypes: [{ ...type, directed: false }] },
      { ...options, relationTypes: [{ ...type, maxDegree: 1 }] },
      {
        ...options,
        relationTypes: [{ ...type, directed: false, acyclic: false, maxOutPerSource: 1 }],
      },
      { ...options, relationTypes: [{ ...type, maxInPerTarget: 0 }] },
      { ...options, maxGraphSize: 0 },
      { ...options, maxPageSize: -1 },
    ])
      expect(
        yield* Effect.flip(Layer.build(Relations.layerMemory(invalid)).pipe(Effect.scoped)),
      ).toBeInstanceOf(RelationsInputInvalid);
  }),
);
it.effect("keeps unavailable causes out of public messages", () =>
  Effect.gen(function* () {
    const error = new RelationsStoreUnavailable({ cause: "private driver details" });
    expect(error.kind).toBe("unavailable");
    expect(error.message).toBe("Relations are unavailable. Try again shortly.");
    expect(error.message).not.toContain("private");
    expect(yield* Schema.decodeEffect(RelationsOptions)(options)).toEqual(options);
  }),
);
