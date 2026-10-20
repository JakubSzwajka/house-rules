import { expect, it } from "@effect/vitest";
import { Effect, Schema, SchemaGetter } from "effect";
import { McpSchema } from "effect/ai";
import { decodeInput } from "../index.ts";
import { mcpProbe, wireValue } from "./mcp-probe.ts";

const strict = { onExcessProperty: "error" } as const;
const outcome = <A, E>(result: Effect.Effect<A, E>) =>
  Effect.map(Effect.result(result), (settled) =>
    settled._tag === "Success" ? { accepts: true, value: settled.success } : { accepts: false },
  );
const prototypeKeys = ["__proto__", "constructor", "toString", "hasOwnProperty"] as const;
for (const key of prototypeKeys) {
  const input = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("key"), [key]: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("other") }),
  ]);
  const probe = mcpProbe(`key_${key}`, input);
  it.effect(`a member key named ${key} lists and decodes like the real Union`, () =>
    Effect.gen(function* () {
      const json = (yield* probe.schema).inputSchema;
      expect(Object.keys(json["properties"] ?? {})).toEqual(["kind", key]);
      expect(json["required"]).toEqual(["kind"]);
      for (const raw of [
        JSON.parse(`{"kind":"key","${key}":"valid"}`),
        { kind: "other" },
        { kind: "key" },
        JSON.parse(`{"kind":"other","${key}":"valid"}`),
      ]) {
        expect(yield* outcome(probe.decode(raw))).toEqual(
          yield* outcome(Schema.decodeUnknownEffect(input, strict)(raw)),
        );
      }
      expect(
        Object.hasOwn(yield* probe.decode(JSON.parse(`{"kind":"key","${key}":"valid"}`)), key),
      ).toBe(true);
    }),
  );
}
it.effect("a non-enumerable declared schema field is still a known key", () =>
  Effect.gen(function* () {
    const fields = { kind: Schema.Literal("probe"), value: Schema.String };
    Object.defineProperty(fields, "value", { enumerable: false });
    const input = Schema.Union([
      Schema.Struct(fields),
      Schema.Struct({ kind: Schema.Literal("other") }),
    ]);
    const probe = mcpProbe("non_enumerable", input);
    const raw = { kind: "probe", value: "valid" };
    expect(yield* probe.decode(raw)).toEqual(yield* Schema.decodeUnknownEffect(input, strict)(raw));
    expect((yield* probe.schema).inputSchema["properties"]).toHaveProperty("value");
  }),
);

const Nested = Schema.Struct({ list: Schema.Array(Schema.Unknown), raw: Schema.Unknown }).annotate({
  identifier: "Nested",
});
const AnyValue = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("nested"), value: Nested }),
  Schema.Struct({ kind: Schema.Literal("raw"), value: Schema.Unknown }),
]);
const anyValue = mcpProbe("any_value", AnyValue);
const manyUnknownKeys = Object.fromEntries([
  ["kind", "raw"],
  ["value", 1],
  ...Array.from({ length: 100_000 }, (_, index) => [`x${index}`, index]),
]);
const adversarial: ReadonlyArray<readonly [string, unknown]> = [
  ["nested", { kind: "nested", value: { list: [null, [], { constructor: 7 }], raw: { n: 1 } } }],
  ["nested unknown key", { kind: "nested", value: { list: [], raw: null, extra: 1 } }],
  ...[null, [], {}, [1], 1, "x", false, undefined].map((raw, index): readonly [string, unknown] => [
    `top-level ${index}`,
    raw,
  ]),
  ...[
    null,
    [],
    [1, 2],
    Object.create(null),
    new Uint8Array(2),
    "x".repeat(1_000_000),
    Array(100_000).fill(null),
  ].map((value, index): readonly [string, unknown] => [
    `raw value ${index}`,
    { kind: "raw", value },
  ]),
  ["own unknown __proto__", JSON.parse('{"kind":"raw","value":1,"__proto__":{"polluted":true}}')],
  ["unknown constructor", { kind: "raw", value: 1, constructor: 7 }],
  ["unknown numeric key", { kind: "raw", value: 1, 0: 2 }],
  ["unknown symbol key", { kind: "raw", value: 1, [Symbol("value")]: 3 }],
  ["unknown symbol-like key", { kind: "raw", value: 1, "Symbol(value)": 3 }],
  ["100,000 unknown keys", manyUnknownKeys],
  ["null prototype", Object.assign(Object.create(null), { kind: "raw", value: { deep: [1] } })],
  ["inherited known keys", Object.create({ kind: "raw", value: 1 })],
];
for (const [name, raw] of adversarial) {
  it.effect(`served JSON decoding matches the real Union: ${name}`, () =>
    Effect.gen(function* () {
      const wire = wireValue(raw);
      const expected = yield* outcome(Schema.decodeUnknownEffect(AnyValue, strict)(wire));
      expect(yield* outcome(anyValue.decode(raw))).toEqual(expected);
      expect(anyValue.calls).toEqual(expected.accepts ? [expected.value] : []);
    }),
  );
}
for (const key of ["0", "Symbol(value)"]) {
  it.effect(`a declared key ${key} in one member decodes like the real Union`, () =>
    Effect.gen(function* () {
      const input = Schema.Union([
        Schema.Struct({ kind: Schema.Literal("key"), [key]: Schema.String }),
        Schema.Struct({ kind: Schema.Literal("other") }),
      ]);
      const probe = mcpProbe("odd_key", input);
      const raw = { kind: "key", [key]: "yes" };
      expect(yield* probe.decode(raw)).toEqual(
        yield* Schema.decodeUnknownEffect(input, strict)(raw),
      );
    }),
  );
}
it.effect(
  "the gate preserves the known value's identity between transport decoding and entry decoding",
  () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const capture = Schema.Unknown.pipe(
        Schema.decodeTo(Schema.Unknown, {
          decode: SchemaGetter.transform((value) => {
            seen.push(value);
            return value;
          }),
          encode: SchemaGetter.passthrough(),
        }),
      );
      const input = Schema.Union([
        Schema.Struct({ kind: Schema.Literal("yes"), value: capture }),
        Schema.Struct({ kind: Schema.Literal("no"), value: Schema.String }),
      ]);
      const probe = mcpProbe("capture", input);
      const decoded = yield* probe.decode(
        Object.freeze({
          kind: "yes",
          value: Object.freeze({ nested: Object.freeze([null, { a: 1 }]) }),
        }),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((value) => value === decoded.value)).toBe(true);
      expect(probe.calls).toHaveLength(1);
    }),
);
it.effect("an empty Struct member still rejects non-object MCP arguments", () =>
  Effect.gen(function* () {
    const input = Schema.Union([
      Schema.Struct({}),
      Schema.Struct({ kind: Schema.Literal("object") }),
    ]);
    const probe = mcpProbe("empty_member", input);
    for (const raw of [1, false, "text", [], [1]]) {
      expect((yield* outcome(Schema.decodeUnknownEffect(input, strict)(raw))).accepts).toBe(true);
      expect((yield* outcome(probe.decode(raw))).accepts, JSON.stringify(raw)).toBe(false);
    }
    yield* Effect.flip(probe.decode(null));
    yield* Effect.flip(
      Schema.decodeUnknownEffect(Schema.toCodecJson(McpSchema.CallTool.payloadSchema))({
        name: "empty_member",
        arguments: null,
      }),
    );
    const normalized = yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(McpSchema.CallTool.payloadSchema),
    )({ name: "empty_member" });
    expect(normalized.arguments).toEqual({});
    expect(yield* probe.decode(undefined)).toEqual({});
    for (const raw of [null, undefined]) yield* Effect.flip(decodeInput(probe.entry, raw, "json"));
    expect(yield* probe.decode({})).toEqual({});
  }),
);
const localRefs = (node: unknown): readonly string[] =>
  typeof node !== "object" || node === null
    ? []
    : [
        ...("$ref" in node && typeof node.$ref === "string" ? [node.$ref] : []),
        ...Object.values(node).flatMap(localRefs),
      ];
it.effect("the MCP server lists a closed object with resolving local refs", () =>
  Effect.gen(function* () {
    const listed = (yield* anyValue.schema).inputSchema;
    expect(listed).toMatchObject({
      type: "object",
      required: ["kind", "value"],
      additionalProperties: false,
    });
    const refs = localRefs(listed);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/$defs/")).toBe(true);
      expect(listed["$defs"]).toHaveProperty([ref.slice("#/$defs/".length)]);
    }
  }),
);
it.effect("the MCP server runs the handler exactly for objects the wire Union accepts", () =>
  Effect.gen(function* () {
    for (const [name, raw] of adversarial) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
      const expected = yield* outcome(Schema.decodeUnknownEffect(AnyValue, strict)(wireValue(raw)));
      expect(yield* outcome(anyValue.decode(raw)), name).toEqual(expected);
      expect(anyValue.calls, name).toEqual(expected.accepts ? [expected.value] : []);
    }
  }),
);
