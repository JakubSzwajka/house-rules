import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, SchemaGetter } from "effect";
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

  it.effect(`a member key named ${key} builds a tool and decodes like the real Union`, () =>
    Effect.gen(function* prototypeKey() {
      const tool = makeTool(`key_${key}`, input);
      const json = Tool.getJsonSchema(tool);
      expect(Object.keys(json.properties ?? {})).toEqual(["kind", key]);
      expect(json.required).toEqual(["kind"]);
      for (const raw of [
        JSON.parse(`{"kind":"key","${key}":"valid"}`),
        { kind: "other" },
        { kind: "key" },
        JSON.parse(`{"kind":"other","${key}":"valid"}`),
      ]) {
        const real = yield* outcome(Schema.decodeUnknownEffect(input, strict)(raw));
        const merged = yield* outcome(
          Schema.decodeUnknownEffect(tool.parametersSchema, strict)(raw),
        );
        expect(merged, JSON.stringify(raw)).toEqual(real);
      }
      const decoded = yield* Schema.decodeUnknownEffect(
        tool.parametersSchema,
        strict,
      )(JSON.parse(`{"kind":"key","${key}":"valid"}`));
      expect(Object.hasOwn(decoded, key)).toBe(true);
    }),
  );
}

it.effect("a non-enumerable declared field is still a known key", () =>
  Effect.gen(function* nonEnumerable() {
    const fields = { kind: Schema.Literal("probe"), value: Schema.String };
    Object.defineProperty(fields, "value", { enumerable: false });
    const input = Schema.Union([
      Schema.Struct(fields),
      Schema.Struct({ kind: Schema.Literal("other") }),
    ]);
    const tool = makeTool("non_enumerable", input);
    const raw = { kind: "probe", value: "valid" };
    expect(yield* Schema.decodeUnknownEffect(tool.parametersSchema, strict)(raw)).toEqual(
      yield* Schema.decodeUnknownEffect(input, strict)(raw),
    );
    expect(Tool.getJsonSchema(tool).properties).toHaveProperty("value");
  }),
);

const Nested = Schema.Struct({ list: Schema.Array(Schema.Unknown), raw: Schema.Unknown }).annotate({
  identifier: "Nested",
});

const AnyValue = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("nested"), value: Nested }),
  Schema.Struct({ kind: Schema.Literal("raw"), value: Schema.Unknown }),
]);

const AnyValueTool = makeTool("any_value", AnyValue);

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
  it.effect(`strict decoding matches the real Union: ${name}`, () =>
    Effect.gen(function* parity() {
      const expected = yield* outcome(Schema.decodeUnknownEffect(AnyValue, strict)(raw));
      expect(
        yield* outcome(Schema.decodeUnknownEffect(AnyValueTool.parametersSchema, strict)(raw)),
      ).toEqual(expected);
      expect(
        yield* outcome(
          Schema.decodeUnknownEffect(
            Schema.toCodecJson(AnyValueTool.parametersSchema),
            strict,
          )(raw),
        ),
      ).toEqual(expected);
    }),
  );
}

for (const key of ["0", "Symbol(value)"]) {
  it.effect(`a declared key ${key} in one member decodes like the real Union`, () =>
    Effect.gen(function* oddKey() {
      const input = Schema.Union([
        Schema.Struct({ kind: Schema.Literal("key"), [key]: Schema.String }),
        Schema.Struct({ kind: Schema.Literal("other") }),
      ]);
      const raw = { kind: "key", [key]: "yes" };
      const merged = Schema.decodeUnknownEffect(
        makeTool("odd_key", input).parametersSchema,
        strict,
      );
      expect(yield* merged(raw)).toEqual(yield* Schema.decodeUnknownEffect(input, strict)(raw));
    }),
  );
}

it.effect("the gate neither reads nor replaces a known value before the Union decodes it", () =>
  Effect.gen(function* identity() {
    const seen: Array<unknown> = [];
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
    const value = Object.freeze({ nested: Object.freeze([null, { a: 1 }]) });
    const decoded = yield* Schema.decodeUnknownEffect(
      makeTool("capture", input).parametersSchema,
      strict,
    )(Object.freeze({ kind: "yes", value }));
    expect(seen).toEqual([value]);
    expect(seen[0]).toBe(value);
    expect(decoded.value).toBe(value);
  }),
);

it.effect("an empty Struct member: the gate still refuses arguments that are not an object", () =>
  Effect.gen(function* emptyMember() {
    const input = Schema.Union([
      Schema.Struct({}),
      Schema.Struct({ kind: Schema.Literal("object") }),
    ]);
    const tool = makeTool("empty_member", input);
    for (const raw of [1, false, "text", [], [1]]) {
      // Effect's empty Struct takes any non-nullish value; MCP arguments are always a JSON object.
      expect((yield* outcome(Schema.decodeUnknownEffect(input, strict)(raw))).accepts).toBe(true);
      expect(
        (yield* outcome(Schema.decodeUnknownEffect(tool.parametersSchema, strict)(raw))).accepts,
      ).toBe(false);
    }
    for (const raw of [null, undefined]) {
      expect(
        (yield* outcome(Schema.decodeUnknownEffect(tool.parametersSchema, strict)(raw))).accepts,
      ).toBe(false);
    }
    expect(yield* Schema.decodeUnknownEffect(tool.parametersSchema, strict)({})).toEqual({});
  }),
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

const calls: Array<unknown> = [];

const Tools = Toolkit.make(AnyValueTool);

const server = McpServer.toolkit(Tools).pipe(
  Layer.provide(
    Tools.toLayer({
      any_value: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return "ok";
        }),
    }),
  ),
  Layer.provideMerge(McpServer.McpServer.layer),
);

const localRefs = (node: unknown): ReadonlyArray<string> => {
  if (typeof node !== "object" || node === null) return [];
  const own = "$ref" in node && typeof node.$ref === "string" ? [node.$ref] : [];
  return [...own, ...Object.values(node).flatMap(localRefs)];
};

it.layer(server)("an MCP server with adversarial arguments", (test) => {
  test.effect("lists a closed object whose $defs references resolve", () =>
    Effect.gen(function* listing() {
      const mcp = yield* McpServer.McpServer;
      const listed = mcp.tools.find(({ tool }) => tool.name === "any_value")?.tool.inputSchema;
      expect(listed).toMatchObject({
        type: "object",
        required: ["kind", "value"],
        additionalProperties: false,
      });
      const refs = localRefs(listed);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref.startsWith("#/$defs/")).toBe(true);
        expect(listed?.$defs).toHaveProperty([ref.slice("#/$defs/".length)]);
      }
    }),
  );

  test.effect("runs the handler exactly when the real Union accepts the object", () =>
    Effect.gen(function* overMcp() {
      const mcp = yield* McpServer.McpServer;
      for (const [name, raw] of adversarial) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
        calls.length = 0;
        const expected = yield* outcome(Schema.decodeUnknownEffect(AnyValue, strict)(raw));
        const result = yield* Effect.result(
          mcp
            .callTool({ name: "any_value", arguments: raw as Record<string, unknown> })
            .pipe(Effect.provideService(McpSchema.McpServerClient, client)),
        );
        expect(result._tag, name).toBe(expected.accepts ? "Success" : "Failure");
        expect(calls, name).toEqual(expected.accepts ? [expected.value] : []);
      }
    }),
  );
});
