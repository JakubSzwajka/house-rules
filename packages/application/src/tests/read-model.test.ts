import { expect, it } from "@effect/vitest";
import { asSystem, defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { defineFeature, defineReadModel, type AnyEntryPoint } from "../contract.ts";
import { bindOperation, GraphInvalid, Runtime } from "../index.ts";

const schemas = {
  description: "Probe",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
} as const;

it("distinguishes commands from reads without guessing from readOnly", () => {
  const command = defineFeature("get_command", {
    ...schemas,
    flags: { readOnly: true },
    handler: () => Effect.void,
  });
  const query = defineReadModel("post_query", { ...schemas, handler: () => Effect.void });
  expect(command.kind).toBe("feature");
  expect(query.kind).toBe("read-model");
  expect(query.readOnly).toBe(true);
});

it.effect("rejects direct, process and system read-to-write reachability", () =>
  Effect.gen(function* () {
    const write = defineOperation("write", schemas);
    for (const system of [false, true]) {
      const process = defineOperation("process", {
        ...schemas,
        readOnly: true,
        edges: [system ? asSystem(write, "test") : write],
      });
      for (const target of [write, process]) {
        const query = defineReadModel("query", {
          ...schemas,
          // @ts-expect-error a direct write is not a read target
          edges: [system ? asSystem(target, "test") : target],
          handler: () => Effect.void,
        });
        const error = yield* Effect.flip(
          Runtime.make({
            features: [query],
            ways: [],
            bindings: [
              bindOperation(write, () => Effect.void),
              bindOperation(process, () => Effect.void),
            ],
          }),
        );
        expect(error).toBeInstanceOf(GraphInvalid);
        expect(error.reason).toContain("Read-only");
      }
    }
  }),
);

it.effect("does not trust conflicting operation flags to hide a transitive write", () =>
  Effect.gen(function* () {
    const write = defineOperation("write", schemas);
    const process = {
      ...defineOperation("process", { ...schemas, readOnly: true }),
      flags: { readOnly: false },
      edges: [write],
    };
    const query = defineReadModel("query", {
      ...schemas,
      edges: [process],
      handler: () => Effect.void,
    });
    const error = yield* Effect.flip(
      Runtime.make({
        features: [query],
        ways: [],
        bindings: [
          bindOperation(write, () => Effect.void),
          bindOperation(process, () => Effect.void),
        ],
      }),
    );
    expect(error).toBeInstanceOf(GraphInvalid);
    expect(error.reason).toContain("Read-only");
  }),
);

it.effect("rejects entry targets, forged identities and duplicate query exposure", () =>
  Effect.gen(function* () {
    const query = defineReadModel("query", { ...schemas, handler: () => Effect.void });
    const command = defineFeature("command", {
      ...schemas,
      // @ts-expect-error entries cannot call entries
      edges: [query],
      handler: () => Effect.void,
    });
    for (const options of [
      { features: [query, command], ways: [] },
      { features: [{ ...query }], ways: [] },
      { features: [query], ways: [{ name: "web", features: [query, query] }] },
    ] satisfies readonly {
      features: readonly AnyEntryPoint[];
      ways: readonly { name: string; features: readonly AnyEntryPoint[] }[];
    }[]) {
      expect(yield* Effect.flip(Runtime.make({ ...options, bindings: [] }))).toBeInstanceOf(
        GraphInvalid,
      );
    }
  }),
);
