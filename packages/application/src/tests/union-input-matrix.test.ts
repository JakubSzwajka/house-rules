import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { mcpProbe, wireValue } from "./mcp-probe.ts";

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
  const name = form;
  const input = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("probe"), value: field }),
    Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
  ]);
  const probe = mcpProbe(name, input);
  const real = (raw: unknown) => outcome(Schema.decodeUnknownEffect(input, strict)(wireValue(raw)));
  const served = (raw: unknown) => outcome(probe.decode(raw));

  it.effect(
    `${name}: advertises value as optional only when a member visibly takes it missing`,
    () =>
      Effect.gen(function* () {
        const required = (yield* probe.schema).inputSchema["required"] as
          | readonly string[]
          | undefined;
        expect(required?.includes("value") ?? false).toBe(advertisedRequired[form]);
        expect(required).toContain("kind");
      }),
  );

  it.effect(`${name}: served parameters decode like the real Union on the wire`, () =>
    Effect.gen(function* () {
      for (const raw of candidates)
        expect(yield* served(raw), JSON.stringify(raw)).toEqual(yield* real(raw));
    }),
  );

  it.effect.prop(
    `${name}: served parameters accept exactly what the JSON Union accepts`,
    [RawInput],
    ([raw]) =>
      Effect.gen(function* () {
        expect(yield* served(raw)).toEqual(yield* real(raw));
      }),
  );

  it.effect(`${name}: an MCP handler runs only for what the real Union accepts`, () =>
    Effect.gen(function* () {
      for (const raw of candidates) {
        const expected = yield* real(raw);
        const result = yield* served(raw);
        expect(result.accepts, JSON.stringify(raw)).toBe(expected.accepts);
        expect(probe.calls, JSON.stringify(raw)).toEqual(expected.accepts ? [expected.value] : []);
      }
    }),
  );
}
