import { expect, expectTypeOf, it } from "@effect/vitest";
import { defineNode, NoInput } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { defineEntry } from "../index.ts";
import { bindFixture, runFixture } from "./entry-fixtures.ts";
import { mcpProbe } from "./mcp-probe.ts";
const ping = bindFixture(
  defineEntry(
    defineNode("ping", {
      description: "Answer pong.",
      input: NoInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  () => Effect.succeed("pong"),
);
it.effect("a bound node with no input is called with an empty object", () =>
  Effect.gen(function* () {
    expectTypeOf<typeof ping.node.input.Type>().toEqualTypeOf<{ readonly [x: string]: never }>();
    expect(yield* runFixture(ping, {})).toBe("pong");
  }),
);
it("NoInput accepts only an empty object", () => {
  expect(Schema.is(NoInput)({})).toBe(true);
  expect(Schema.is(NoInput)({ name: "Ada" })).toBe(false);
});
it("NoInput renders an object like Effect's EmptyParams", () => {
  const rendered = Schema.toJsonSchemaDocument(NoInput).schema;
  expect(rendered).toEqual({ type: "object", additionalProperties: false });
  expect(rendered).toEqual(Schema.toJsonSchemaDocument(Tool.EmptyParams).schema);
});
const probe = mcpProbe("ping", NoInput);
it.effect("the MCP router lists NoInput as an empty object and accepts omitted arguments", () =>
  Effect.gen(function* () {
    expect((yield* probe.schema).inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
    });
    expect(yield* probe.decode(undefined)).toEqual({});
  }),
);
