import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { mcpProbe, ProbeRejected } from "./mcp-probe.ts";

const TrimOrLiteral = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("trim"), id: Schema.Trim }),
  Schema.Struct({ kind: Schema.Literal("literal"), id: Schema.Literal("abc") }),
]);
const NumberOrText = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("number"), id: Schema.FiniteFromString }),
  Schema.Struct({ kind: Schema.Literal("text"), id: Schema.String }),
]);
const DefaultOrText = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("default"),
    value: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultKey(Effect.succeed("42"))),
  }),
  Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
]);
const trim = mcpProbe("pick_trim", TrimOrLiteral);
const number = mcpProbe("pick_number", NumberOrText);
const defaulted = mcpProbe("pick_default", DefaultOrText);

it.effect("raw input fitting no member fails even when another member has a codec", () =>
  Effect.gen(function* () {
    const raw = { kind: "literal", id: " abc " };
    yield* Effect.flip(Schema.decodeUnknownEffect(TrimOrLiteral)(raw));
    yield* Effect.flip(trim.decode(raw));
    expect(trim.calls).toEqual([]);
  }),
);
it.effect("valid input of every member decodes independently of the other codecs", () =>
  Effect.gen(function* () {
    expect(yield* number.decode({ kind: "text", id: "123" })).toEqual({ kind: "text", id: "123" });
    expect(yield* number.decode({ kind: "number", id: "123" })).toEqual({
      kind: "number",
      id: 123,
    });
    expect(yield* trim.decode({ kind: "trim", id: " x " })).toEqual({ kind: "trim", id: "x" });
    expect(yield* trim.decode({ kind: "literal", id: "abc" })).toEqual({
      kind: "literal",
      id: "abc",
    });
  }),
);
it.effect("the listed object advertises each member's wire type rather than decoded type", () =>
  Effect.gen(function* () {
    expect((yield* trim.schema).inputSchema).toEqual({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["trim", "literal"] },
        id: { anyOf: [{ type: "string" }, { type: "string", enum: ["abc"] }] },
      },
      required: ["kind", "id"],
      additionalProperties: false,
    });
    expect((yield* number.schema).inputSchema).toMatchObject({
      properties: { id: { anyOf: [{ type: "string" }, { type: "string" }] } },
    });
  }),
);
it.effect("a decoding default accepts an absent wire key only in its own member", () =>
  Effect.gen(function* () {
    expect(yield* defaulted.decode({ kind: "default" })).toEqual({ kind: "default", value: 42 });
    expect(yield* defaulted.decode({ kind: "default", value: "12" })).toEqual({
      kind: "default",
      value: 12,
    });
    expect(yield* defaulted.decode({ kind: "text", value: "12" })).toEqual({
      kind: "text",
      value: "12",
    });
    yield* Effect.flip(defaulted.decode({ kind: "text" }));
  }),
);
it.effect(
  "a defaulted key is advertised as required even when the descriptor's wire type is optional",
  () =>
    Effect.gen(function* () {
      expect((yield* defaulted.schema).inputSchema).toMatchObject({ required: ["kind", "value"] });
      expectTypeOf<typeof DefaultOrText.Encoded>().toExtend<{
        readonly kind: "default" | "text";
        readonly value?: string;
      }>();
      expectTypeOf<typeof defaulted.entry.node.input.Type>().toEqualTypeOf<
        typeof DefaultOrText.Type
      >();
    }),
);
const probeOrText = (value: Schema.Codec<string>) =>
  mcpProbe(
    "probe",
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("probe"), value }),
      Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
    ]),
  );
it.effect("a required wire key may still be filled or omitted by its member decoder", () =>
  Effect.gen(function* () {
    const getterDefault = probeOrText(
      Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.withDefault(Effect.succeed("fallback")),
          encode: SchemaGetter.passthrough(),
        }),
      ),
    );
    const optionalDecoded = probeOrText(
      Schema.String.pipe(
        Schema.decodeTo(Schema.optionalKey(Schema.String), SchemaTransformation.passthrough()),
      ),
    );
    expect(yield* getterDefault.decode({ kind: "probe" })).toEqual({
      kind: "probe",
      value: "fallback",
    });
    expect(yield* optionalDecoded.decode({ kind: "probe" })).toEqual({ kind: "probe" });
    expect((yield* getterDefault.schema).inputSchema).toMatchObject({
      required: ["kind", "value"],
    });
    expect((yield* optionalDecoded.schema).inputSchema).toMatchObject({
      required: ["kind", "value"],
    });
  }),
);
it.effect("an MCP handler is never reached for raw input fitting no member", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(trim.decode({ kind: "literal", id: " abc " }));
    expect(error).toBeInstanceOf(ProbeRejected);
    expect(error.message).toContain("Invalid parameters");
    expect(trim.calls).toEqual([]);
  }),
);
it.effect("an MCP handler receives the decoded value of each valid member", () =>
  Effect.gen(function* () {
    for (const [probe, raw, expected] of [
      [number, { kind: "text", id: "123" }, { kind: "text", id: "123" }],
      [number, { kind: "number", id: "123" }, { kind: "number", id: 123 }],
      [trim, { kind: "trim", id: " x " }, { kind: "trim", id: "x" }],
    ] as const) {
      expect(yield* probe.decode(raw)).toEqual(expected);
      expect(probe.calls).toEqual([expected]);
    }
  }),
);
it.effect("an MCP handler gets the default only for the member that declares it", () =>
  Effect.gen(function* () {
    expect(yield* defaulted.decode({ kind: "default" })).toEqual({ kind: "default", value: 42 });
    expect(defaulted.calls).toEqual([{ kind: "default", value: 42 }]);
    const error = yield* Effect.flip(defaulted.decode({ kind: "text" }));
    expect(error).toBeInstanceOf(ProbeRejected);
    expect(defaulted.calls).toEqual([]);
  }),
);
