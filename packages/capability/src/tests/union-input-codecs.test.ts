import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { defineContract, implement, toTool } from "../index.ts";

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

const options = { title: "Pick", idempotent: true, openWorld: false };

const trimContract = defineContract("pick_trim", {
  description: "Pick by a trimmed id or by the literal id.",
  input: TrimOrLiteral,
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

const numberContract = defineContract("pick_number", {
  description: "Pick by a numeric id or by a text id.",
  input: NumberOrText,
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

const defaultContract = defineContract("pick_default", {
  description: "Pick by a numeric value with a default, or by a text value.",
  input: DefaultOrText,
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

const received: Array<unknown> = [];

const record = (input: unknown) =>
  Effect.sync(() => {
    received.push(input);
    return JSON.stringify(input);
  });

const pickTrim = implement(trimContract, record);
const pickNumber = implement(numberContract, record);
const pickDefault = implement(defaultContract, record);

const TrimTool = toTool(trimContract, options);
const NumberTool = toTool(numberContract, options);
const DefaultTool = toTool(defaultContract, options);

it.effect("a raw input that fits no member fails, whatever another member's codec does", () =>
  Effect.gen(function* noMember() {
    const raw = { kind: "literal", id: " abc " };
    yield* Effect.flip(Schema.decodeUnknownEffect(TrimOrLiteral)(raw));
    yield* Effect.flip(Schema.decodeUnknownEffect(TrimTool.parametersSchema)(raw));
  }),
);

it.effect("a valid input of any member decodes, whatever another member's codec does", () =>
  Effect.gen(function* everyMember() {
    const decode = Schema.decodeUnknownEffect(NumberTool.parametersSchema);
    expect(yield* decode({ kind: "text", id: "123" })).toEqual({ kind: "text", id: "123" });
    expect(yield* decode({ kind: "number", id: "123" })).toEqual({ kind: "number", id: 123 });
    const trim = Schema.decodeUnknownEffect(TrimTool.parametersSchema);
    expect(yield* trim({ kind: "trim", id: " x " })).toEqual({ kind: "trim", id: "x" });
    expect(yield* trim({ kind: "literal", id: "abc" })).toEqual({ kind: "literal", id: "abc" });
  }),
);

it.effect("the merged object advertises each member's wire type, not its decoded type", () =>
  Effect.sync(() => {
    expect(Tool.getJsonSchema(TrimTool)).toEqual({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["trim", "literal"] },
        id: { anyOf: [{ type: "string" }, { type: "string", enum: ["abc"] }] },
      },
      required: ["kind", "id"],
      // The gate refuses keys no member takes, under any parse options.
      additionalProperties: false,
    });
    // FiniteFromString travels as a string, so neither id variant is a number.
    expect(Tool.getJsonSchema(NumberTool)).toMatchObject({
      properties: { id: { anyOf: [{ type: "string" }, { type: "string" }] } },
    });
  }),
);

it.effect("a key one member fills with a decoding default may be missing from the raw input", () =>
  Effect.gen(function* decodingDefault() {
    const decode = Schema.decodeUnknownEffect(DefaultTool.parametersSchema);
    expect(yield* decode({ kind: "default" })).toEqual({ kind: "default", value: 42 });
    expect(yield* decode({ kind: "default", value: "12" })).toEqual({ kind: "default", value: 12 });
    expect(yield* decode({ kind: "text", value: "12" })).toEqual({ kind: "text", value: "12" });
    // The real Union still requires the key for the member without a default.
    yield* Effect.flip(decode({ kind: "text" }));
  }),
);

it("a key a member fills with a decoding default is still advertised as required", () => {
  expect(Tool.getJsonSchema(DefaultTool)).toMatchObject({ required: ["kind", "value"] });
  expectTypeOf(DefaultTool.parametersSchema.Encoded).toEqualTypeOf<{
    readonly kind: "default" | "text";
    readonly value?: string;
  }>();
  expectTypeOf(DefaultTool.parametersSchema.Type).toEqualTypeOf<typeof DefaultOrText.Type>();
});

const probeOrText = (value: Schema.Codec<string>) =>
  toTool(
    defineContract("probe", {
      description: "Probe a value, or give it as text.",
      input: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("probe"), value }),
        Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
      ]),
      output: Schema.String,
      failure: Schema.Never,
      permission: "public",
    }),
    options,
  );

it.effect("a key the wire requires but a member's decoder fills may still be missing", () =>
  Effect.gen(function* decoderFills() {
    const getterDefault = probeOrText(
      Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.withDefault(Effect.succeed("fallback")),
          encode: SchemaGetter.passthrough(),
        }),
      ),
    );
    const optionalWhenDecoded = probeOrText(
      Schema.String.pipe(
        Schema.decodeTo(Schema.optionalKey(Schema.String), SchemaTransformation.passthrough()),
      ),
    );
    const raw = { kind: "probe" };
    expect(yield* Schema.decodeUnknownEffect(getterDefault.parametersSchema)(raw)).toEqual({
      kind: "probe",
      value: "fallback",
    });
    expect(yield* Schema.decodeUnknownEffect(optionalWhenDecoded.parametersSchema)(raw)).toEqual(
      raw,
    );
    expect(Tool.getJsonSchema(getterDefault)).toMatchObject({ required: ["kind", "value"] });
    expect(Tool.getJsonSchema(optionalWhenDecoded)).toMatchObject({ required: ["kind", "value"] });
  }),
);

const Tools = Toolkit.make(TrimTool, NumberTool, DefaultTool);

const toolsServer = McpServer.toolkit(Tools).pipe(
  Layer.provide(
    Tools.toLayer({
      pick_trim: (input) => pickTrim.handler(input),
      pick_number: (input) => pickNumber.handler(input),
      pick_default: (input) => pickDefault.handler(input),
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

const call = (name: string, args: Record<string, unknown>) =>
  Effect.gen(function* callTool() {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(Effect.provideService(McpSchema.McpServerClient, client));
  });

it.layer(toolsServer)("an MCP server with codec members", (test) => {
  test.effect("never runs the handler for raw input that fits no member", () =>
    Effect.gen(function* guard() {
      received.length = 0;
      const error = yield* Effect.flip(call("pick_trim", { kind: "literal", id: " abc " }));
      expect(error).toBeInstanceOf(McpSchema.InvalidParams);
      expect(received).toEqual([]);
    }),
  );

  test.effect("runs the handler for a valid input of every member", () =>
    Effect.gen(function* valid() {
      received.length = 0;
      const text = yield* call("pick_number", { kind: "text", id: "123" });
      const number = yield* call("pick_number", { kind: "number", id: "123" });
      const trim = yield* call("pick_trim", { kind: "trim", id: " x " });
      expect([text.isError, number.isError, trim.isError]).toEqual([false, false, false]);
      expect(received).toEqual([
        { kind: "text", id: "123" },
        { kind: "number", id: 123 },
        { kind: "trim", id: "x" },
      ]);
    }),
  );

  test.effect("runs the handler with the default when the defaulted key is missing", () =>
    Effect.gen(function* defaulted() {
      received.length = 0;
      const result = yield* call("pick_default", { kind: "default" });
      expect(result.isError).toBe(false);
      expect(received).toEqual([{ kind: "default", value: 42 }]);
      const error = yield* Effect.flip(call("pick_default", { kind: "text" }));
      expect(error).toBeInstanceOf(McpSchema.InvalidParams);
      expect(received).toEqual([{ kind: "default", value: 42 }]);
    }),
  );
});
