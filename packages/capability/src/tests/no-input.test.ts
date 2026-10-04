import { expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { defineContract, implement, NoInput } from "../index.ts";

const pingContract = defineContract("ping", {
  description: "Answer pong.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
  annotations: { readOnly: true },
});

const ping = implement(pingContract, () => Effect.succeed("pong"));

it.effect("a handler with no input is called with an empty object", () =>
  Effect.gen(function* callsWithEmptyObject() {
    expectTypeOf(ping.handler).parameter(0).toEqualTypeOf<{ readonly [x: string]: never }>();
    expect(yield* ping.handler({})).toBe("pong");
  }),
);

it.effect("NoInput accepts only an empty object", () =>
  Effect.sync(() => {
    expect(Schema.is(NoInput)({})).toBe(true);
    expect(Schema.is(NoInput)({ name: "Ada" })).toBe(false);
  }),
);

it.effect("NoInput renders to JSON Schema as an object, like Tool.EmptyParams", () =>
  Effect.sync(() => {
    const rendered = Schema.toJsonSchemaDocument(NoInput).schema;

    expect(rendered).toEqual({ type: "object", additionalProperties: false });
    expect(rendered).toEqual(Schema.toJsonSchemaDocument(Tool.EmptyParams).schema);
  }),
);

const PingTools = Toolkit.make(
  Tool.make(pingContract.name, {
    description: pingContract.description,
    parameters: pingContract.input,
    success: pingContract.output,
  }),
);

const pingHandlers = PingTools.toLayer({ ping: () => ping.handler({}) });

it.layer(McpServer.McpServer.layer)("an MCP server", (test) => {
  test.effect("lists a tool whose parameters are a NoInput contract input", () =>
    Effect.gen(function* listsNoInputTool() {
      yield* McpServer.registerToolkit(PingTools).pipe(Effect.provide(pingHandlers));
      const server = yield* McpServer.McpServer;

      expect(server.tools.map(({ tool }) => [tool.name, tool.inputSchema])).toEqual([
        ["ping", { type: "object", additionalProperties: false }],
      ]);
    }),
  );
});
