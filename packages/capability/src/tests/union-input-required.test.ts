import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { defineContract, type InputSchema, toTool } from "../index.ts";

const strict = { onExcessProperty: "error" } as const;

const options = { title: "Probe", idempotent: true, openWorld: false };

const makeTool = <Input extends InputSchema>(name: string, input: Input) =>
  toTool(
    defineContract(name, {
      description: "A Union input probe.",
      input,
      output: Schema.String,
      failure: Schema.Never,
      permission: "public",
    }),
    options,
  );

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
      const listed = Tool.getJsonSchema(tool).required as ReadonlyArray<string> | undefined;
      expect(listed?.includes("value") ?? false).toBe(required);
      const omissions: Array<boolean> = [];
      for (const kind of ["probe", "text"]) {
        const real = yield* accepts(Schema.decodeUnknownEffect(input, strict)({ kind }));
        const merged = yield* accepts(
          Schema.decodeUnknownEffect(tool.parametersSchema, strict)({ kind }),
        );
        expect(merged, kind).toBe(real);
        omissions.push(real);
      }
      if (!required) expect(omissions).toContain(true);
      expect(
        yield* accepts(
          Schema.decodeUnknownEffect(tool.parametersSchema, strict)({ kind: "text", value: "v" }),
        ),
      ).toBe(true);
    }),
  );
}

it("the static wire type keeps the encoded side while the JSON errs strict", () => {
  const tool = makeTool("wire_type", OptionalWireRequiredOutput);
  expectTypeOf(tool.parametersSchema.Encoded).toEqualTypeOf<{
    readonly kind: "probe" | "text";
    readonly value?: string;
  }>();
  expect(Tool.getJsonSchema(tool).required).toEqual(["kind", "value"]);
});

const ReverseTool = makeTool("optional_wire_required_output", OptionalWireRequiredOutput);

const Tools = Toolkit.make(ReverseTool);

const calls: Array<unknown> = [];

const server = McpServer.toolkit(Tools).pipe(
  Layer.provide(
    Tools.toLayer({
      optional_wire_required_output: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return "ok";
        }),
    }),
  ),
  Layer.provideMerge(McpServer.McpServer.layer),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-11-25",
  clientCapabilities: new McpSchema.ClientCapabilities({}),
  clientInfo: { name: "test-client", version: "1.0.0" },
  initializePayload: {
    protocolVersion: "2025-11-25",
    capabilities: new McpSchema.ClientCapabilities({}),
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
  getClient: Effect.die("getClient is not used"),
});

it.layer(server)("an MCP server with a key the Union always needs", (test) => {
  test.effect("lists the key as required and refuses its omission in every member", () =>
    Effect.gen(function* overMcp() {
      const mcp = yield* McpServer.McpServer;
      expect(mcp.tools[0]?.tool.inputSchema.required).toEqual(["kind", "value"]);
      calls.length = 0;
      for (const kind of ["probe", "text"]) {
        const error = yield* Effect.flip(
          mcp
            .callTool({ name: "optional_wire_required_output", arguments: { kind } })
            .pipe(Effect.provideService(McpSchema.McpServerClient, client)),
        );
        expect(error).toBeInstanceOf(McpSchema.InvalidParams);
      }
      expect(calls).toEqual([]);
    }),
  );
});
