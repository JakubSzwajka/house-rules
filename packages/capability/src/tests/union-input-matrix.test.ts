import { expect, it } from "@effect/vitest";
import {
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  SchemaGetter,
  SchemaTransformation,
} from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { defineContract, implement, type InputSchema, toTool } from "../index.ts";

const forms = {
  optionalKey: Schema.optionalKey(Schema.FiniteFromString),
  optional: Schema.optional(Schema.FiniteFromString),
  defaultKey: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultKey(Effect.succeed("42"))),
  default: Schema.FiniteFromString.pipe(Schema.withDecodingDefault(Effect.succeed("42"))),
  defaultTypeKey: Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(42)),
  ),
  defaultType: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultType(Effect.succeed(42))),
  defaultKeyOmit: Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("42"), { encodingStrategy: "omit" }),
  ),
  defaultOmit: Schema.FiniteFromString.pipe(
    Schema.withDecodingDefault(Effect.succeed("42"), { encodingStrategy: "omit" }),
  ),
  defaultTypeKeyOmit: Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(42), { encodingStrategy: "omit" }),
  ),
  defaultTypeOmit: Schema.FiniteFromString.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(42), { encodingStrategy: "omit" }),
  ),
  undefinedOr: Schema.UndefinedOr(Schema.FiniteFromString),
  nullishOr: Schema.NullishOr(Schema.FiniteFromString),
  undefinedOnly: Schema.Undefined,
  constructorDefault: Schema.FiniteFromString.pipe(
    Schema.withConstructorDefault(Effect.succeed(42)),
  ),
  requiredKey: Schema.requiredKey(Schema.optionalKey(Schema.FiniteFromString)),
  required: Schema.required(Schema.optional(Schema.FiniteFromString)),
  optionalNever: Schema.optionalKey(Schema.Never),
  optionalNullOr: Schema.optional(Schema.NullOr(Schema.FiniteFromString)),
  optionalKeyNullOr: Schema.optionalKey(Schema.NullOr(Schema.FiniteFromString)),
  optionKey: Schema.OptionFromOptionalKey(Schema.FiniteFromString),
  option: Schema.OptionFromOptional(Schema.FiniteFromString),
  optionNullOr: Schema.OptionFromOptionalNullOr(Schema.FiniteFromString),
  optionUndefinedOr: Schema.OptionFromUndefinedOr(Schema.FiniteFromString),
  manualDefault: Schema.optionalKey(Schema.NullOr(Schema.String)).pipe(
    Schema.decodeTo(Schema.FiniteFromString, {
      decode: SchemaGetter.transformOptional((value) =>
        value.pipe(
          Option.filter(Predicate.isNotNull),
          Option.orElseSome(() => "42"),
        ),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  ),
  omitUndefined: Schema.optional(Schema.FiniteFromString).pipe(
    Schema.decodeTo(Schema.optionalKey(Schema.Finite), {
      decode: SchemaGetter.transformOptional(Option.filter(Predicate.isNotUndefined)),
      encode: SchemaGetter.passthrough(),
    }),
  ),
  manualDefaultRequiredSource: Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.withDefault(Effect.succeed("fallback")),
      encode: SchemaGetter.passthrough(),
    }),
  ),
  optionalDecodedOnly: Schema.String.pipe(
    Schema.decodeTo(Schema.optionalKey(Schema.String), SchemaTransformation.passthrough()),
  ),
  optionalMutableAnnotated: Schema.optionalKey(Schema.FiniteFromString)
    .pipe(Schema.mutableKey)
    .annotateKey({ description: "Wire optional" }),
  encodedWrapper: Schema.toEncoded(
    Schema.FiniteFromString.pipe(Schema.withDecodingDefaultKey(Effect.succeed("42"))),
  ),
  doubleOptional: Schema.optionalKey(Schema.optional(Schema.FiniteFromString)),
  suspendedOptional: Schema.suspend(() => Schema.optionalKey(Schema.FiniteFromString)),
  fieldUnionOptionalMembers: Schema.Union([
    Schema.optionalKey(Schema.FiniteFromString),
    Schema.String,
  ]),
  nestedDefault: Schema.Struct({
    count: Schema.FiniteFromString.pipe(Schema.withDecodingDefault(Effect.succeed("42"))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
};

type FormName = keyof typeof forms;

type Field = Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never };

const advertisedRequired: Record<FormName, boolean> = {
  optionalKey: false,
  optional: false,
  defaultKey: true,
  default: true,
  defaultTypeKey: true,
  defaultType: true,
  defaultKeyOmit: true,
  defaultOmit: true,
  defaultTypeKeyOmit: true,
  defaultTypeOmit: true,
  undefinedOr: true,
  nullishOr: true,
  undefinedOnly: true,
  constructorDefault: true,
  requiredKey: true,
  required: true,
  optionalNever: false,
  optionalNullOr: false,
  optionalKeyNullOr: false,
  optionKey: true,
  option: true,
  optionNullOr: true,
  optionUndefinedOr: true,
  manualDefault: true,
  omitUndefined: true,
  manualDefaultRequiredSource: true,
  optionalDecodedOnly: true,
  optionalMutableAnnotated: false,
  encodedWrapper: false,
  doubleOptional: false,
  suspendedOptional: true,
  fieldUnionOptionalMembers: true,
  nestedDefault: true,
};

const strict = { onExcessProperty: "error" } as const;

const candidates: ReadonlyArray<Record<string, unknown>> = [
  { kind: "probe" },
  ...[undefined, null, "12", "bad", 12, false, {}, { count: "12" }, { count: undefined }].map(
    (value) => ({ kind: "probe", value }),
  ),
  { kind: "probe", value: { count: "bad" } },
  { kind: "text" },
  { kind: "text", value: "12" },
  { kind: "text", value: undefined },
  { kind: "other", value: "12" },
  { kind: "probe", extra: true },
  { kind: "probe", value: "12", extra: true },
];

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

const Value = Schema.Union([
  Schema.Literals(["12", "bad", " abc ", "fallback"]),
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
  Schema.Undefined,
  Schema.Struct({ count: Schema.optionalKey(Schema.UndefinedOr(Schema.String)) }),
]);

const RawInput = Schema.Struct({
  kind: Schema.optionalKey(Schema.Union([Schema.Literals(["probe", "text", "other"]), Value])),
  value: Schema.optionalKey(Value),
  extra: Schema.optionalKey(Value),
});

const outcome = <A, E>(result: Effect.Effect<A, E>) =>
  Effect.map(Effect.result(result), (settled) =>
    settled._tag === "Success" ? { accepts: true, value: settled.success } : { accepts: false },
  );

for (const [form, field] of Object.entries(forms) as Array<[FormName, Field]>) {
  const name: string = form;
  const input = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("probe"), value: field }),
    Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
  ]);
  const calls: Array<unknown> = [];
  const capability = implement(
    defineContract(name, {
      description: "A Union input with one codec form.",
      input,
      output: Schema.String,
      failure: Schema.Never,
      permission: "public",
    }),
    (decoded) =>
      Effect.sync(() => {
        calls.push(decoded);
        return "ok";
      }),
  );
  const tool = toTool(capability.contract, { title: name, idempotent: true, openWorld: false });
  const real = (raw: unknown, options?: typeof strict) =>
    outcome(Schema.decodeUnknownEffect(input, options)(raw));
  const merged = (raw: unknown, options?: typeof strict) =>
    outcome(Schema.decodeUnknownEffect(tool.parametersSchema, options)(raw));

  it(`${name}: advertises value as optional only when a member visibly takes it missing`, () => {
    const required = Tool.getJsonSchema(tool).required as ReadonlyArray<string> | undefined;
    expect(required?.includes("value") ?? false).toBe(advertisedRequired[form]);
    expect(required).toContain("kind");
  });

  it.effect(`${name}: the tool parameters decode like the real Union`, () =>
    Effect.gen(function* matrix() {
      for (const raw of candidates) {
        expect(yield* merged(raw, strict), JSON.stringify(raw)).toEqual(yield* real(raw, strict));
      }
    }),
  );

  it.effect.prop(
    `${name}: the tool parameters accept exactly what the real Union accepts`,
    [RawInput],
    ([raw]) =>
      Effect.gen(function* property() {
        expect(yield* merged(raw, strict)).toEqual(yield* real(raw, strict));
        // Without strict parsing the Union drops unknown keys; the gate refuses them on purpose.
        if (!("extra" in raw)) expect(yield* merged(raw)).toEqual(yield* real(raw));
      }),
  );

  const toolkit = Toolkit.make(tool);
  const server = McpServer.toolkit(toolkit).pipe(
    Layer.provide(
      toolkit.toLayer({
        [name]: (decoded: InputSchema["Type"]) => capability.handler(decoded as typeof input.Type),
      }),
    ),
    Layer.provideMerge(McpServer.McpServer.layer),
  );

  it.layer(server)(`${name}: an MCP server`, (test) => {
    test.effect("runs the handler only for what the real Union accepts", () =>
      Effect.gen(function* overMcp() {
        const mcp = yield* McpServer.McpServer;
        for (const raw of candidates) {
          calls.length = 0;
          const expected = yield* real(raw, strict);
          const result = yield* Effect.result(
            mcp
              .callTool({ name, arguments: raw })
              .pipe(Effect.provideService(McpSchema.McpServerClient, client)),
          );
          if (expected.accepts) {
            expect(result._tag === "Success" && !result.success.isError, JSON.stringify(raw)).toBe(
              true,
            );
            expect(calls).toEqual([expected.value]);
          } else {
            expect(result._tag === "Failure" ? result.failure : result.success).toBeInstanceOf(
              McpSchema.InvalidParams,
            );
            expect(calls).toEqual([]);
          }
        }
      }),
    );
  });
}
