import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { mcpProbe, ProbeRejected } from "./mcp-probe.ts";

const strict = { onExcessProperty: "error" } as const;

const makeTool = mcpProbe;

const accepts = <A, E>(result: Effect.Effect<A, E>) =>
  Effect.map(Effect.result(result), (settled) => settled._tag === "Success");

type Field = Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never };

const probeOrText = (value: Field) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("probe"), value }),
    Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
  ]);

const valueIsPresent = Schema.makeFilter<{ readonly value?: unknown }>((input) => "value" in input);

const optionalWireRequiredOutput = Schema.optionalKey(Schema.String).pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.passthrough()),
);

const OptionalWireRequiredOutput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("probe"), value: optionalWireRequiredOutput }),
  Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
]);

const cases = {
  optionalWireRequiredOutput: { input: OptionalWireRequiredOutput, required: true },
  requiredGetter: {
    input: probeOrText(
      Schema.optionalKey(Schema.String).pipe(
        Schema.decodeTo(Schema.optionalKey(Schema.String), {
          decode: SchemaGetter.required(),
          encode: SchemaGetter.passthrough(),
        }),
      ),
    ),
    required: true,
  },
  checkedMember: {
    input: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("probe"),
        value: Schema.optionalKey(Schema.String),
      }).check(valueIsPresent),
      Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
    ]),
    required: true,
  },
  checkedUnion: {
    input: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("probe"), value: Schema.optionalKey(Schema.String) }),
      Schema.Struct({ kind: Schema.Literal("text"), value: Schema.optionalKey(Schema.String) }),
    ]).check(valueIsPresent),
    required: true,
  },
  transformOptional: {
    input: probeOrText(
      Schema.optionalKey(Schema.String).pipe(
        Schema.decodeTo(Schema.optionalKey(Schema.String), {
          decode: SchemaGetter.transformOptional((value) => value),
          encode: SchemaGetter.passthrough(),
        }),
      ),
    ),
    required: true,
  },
  middleware: {
    input: probeOrText(
      Schema.optionalKey(Schema.String).pipe(Schema.middlewareDecoding((effect) => effect)),
    ),
    required: true,
  },
  suspended: {
    input: probeOrText(Schema.suspend(() => Schema.optionalKey(Schema.String))),
    required: true,
  },
  optionalKey: { input: probeOrText(Schema.optionalKey(Schema.String)), required: false },
  optionalCodec: {
    input: probeOrText(Schema.optionalKey(Schema.FiniteFromString)),
    required: false,
  },
  optionalChecked: {
    input: probeOrText(Schema.optionalKey(Schema.String.check(Schema.isMinLength(1)))),
    required: false,
  },
};

for (const [name, { input, required }] of Object.entries(cases)) {
  const tool = makeTool(name, input);

  it.effect(`${name}: the advertisement never calls a key optional the Union requires`, () =>
    Effect.gen(function* requiredness() {
      const listed = (yield* tool.schema).inputSchema["required"] as
        | ReadonlyArray<string>
        | undefined;
      expect(listed?.includes("value") ?? false).toBe(required);
      const omissions: Array<boolean> = [];
      for (const kind of ["probe", "text"]) {
        const real = yield* accepts(Schema.decodeUnknownEffect(input, strict)({ kind }));
        const merged = yield* accepts(tool.decode({ kind }));
        expect(merged, kind).toBe(real);
        omissions.push(real);
      }
      if (!required) expect(omissions).toContain(true);
      expect(yield* accepts(tool.decode({ kind: "text", value: "v" }))).toBe(true);
    }),
  );
}

it.effect("the descriptor wire type stays optional while the advertised JSON errs strict", () =>
  Effect.gen(function* () {
    const tool = makeTool("wire_type", OptionalWireRequiredOutput);
    expectTypeOf<typeof OptionalWireRequiredOutput.Encoded>().toExtend<{
      readonly kind: "probe" | "text";
      readonly value?: string;
    }>();
    expect((yield* tool.schema).inputSchema["required"]).toEqual(["kind", "value"]);
  }),
);

const reverse = makeTool("optional_wire_required_output", OptionalWireRequiredOutput);
it.effect("an MCP server lists the key as required and refuses its omission in every member", () =>
  Effect.gen(function* () {
    expect((yield* reverse.schema).inputSchema["required"]).toEqual(["kind", "value"]);
    for (const kind of ["probe", "text"]) {
      const error = yield* Effect.flip(reverse.decode({ kind }));
      expect(error).toBeInstanceOf(ProbeRejected);
      expect(error.message).toContain("Invalid parameters");
    }
    expect(reverse.calls).toEqual([]);
  }),
);
