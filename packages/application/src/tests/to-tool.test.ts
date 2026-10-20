import { afterAll, expect, expectTypeOf, it } from "@effect/vitest";
import { defineNode, errorKind, NoInput } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  ApprovalDenied,
  defineEntry,
  defineWay,
  type EntryFailure,
  Forbidden,
  type InnerFailure,
} from "../index.ts";
import { bindFixture } from "./entry-fixtures.ts";
import { mcpFixture } from "./router-fixtures.ts";
import { callMcpTool, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {
  kind: errorKind("invalid"),
}) {}
const GreetInput = Schema.Struct({ name: Schema.String });
const greet = bindFixture(
  defineEntry(
    defineNode("greet", {
      description: "Greet someone by name.",
      input: GreetInput,
      output: Schema.String,
      failure: NameIsEmpty,
      permission: null,
      readOnly: true,
    }),
  ),
  ({ name }) => (name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`)),
);
const forget = bindFixture(
  defineEntry(
    defineNode("forget", {
      description: "Forget someone.",
      input: GreetInput,
      output: Schema.Void,
      failure: Schema.Never,
      permission: null,
      destructive: true,
    }),
  ),
  () => Effect.void,
);
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
const entries = [greet, forget, ping] as const;
const fixture = mcpFixture(entries, {
  tools: [
    { entry: greet, title: "Greet", idempotent: true, openWorld: false },
    { entry: forget, title: "Forget", idempotent: false, openWorld: true },
    { entry: ping, title: "Ping", idempotent: true, openWorld: false },
  ],
});
afterAll(fixture.dispose);
const session = () => openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
const listing = Effect.gen(function* () {
  const answer = yield* mcpPost(fixture.handler, yield* session(), {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  return answer.messages.find((message) => message.id === 2)?.result?.["tools"] as Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    annotations: Record<string, unknown>;
  }>;
});
it.effect("the router takes the tool name, description and parameters from the entry node", () =>
  Effect.gen(function* () {
    const tool = (yield* listing).find((tool) => tool.name === "greet");
    expect(tool).toMatchObject({
      name: "greet",
      description: "Greet someone by name.",
      inputSchema: {
        ...Schema.toJsonSchemaDocument(GreetInput).schema,
        additionalProperties: false,
      },
    });
  }),
);
it("the entry keeps the precise descriptor schemas and literal flags", () => {
  expectTypeOf(greet.node.name).toEqualTypeOf<"greet">();
  expectTypeOf(greet.node.input).toEqualTypeOf<typeof GreetInput>();
  expectTypeOf(greet.node.output).toEqualTypeOf<typeof Schema.String>();
  expectTypeOf(greet.node.failure).toEqualTypeOf<typeof NameIsEmpty>();
  expectTypeOf(greet.readOnly).toEqualTypeOf<true>();
});
it.effect("readOnly and destructive hints come from lifted entry flags", () =>
  Effect.gen(function* () {
    const tools = yield* listing;
    expect(tools.find((tool) => tool.name === "greet")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tools.find((tool) => tool.name === "forget")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  }),
);
it.effect("title, idempotent and openWorld hints come from the way tool data", () =>
  Effect.gen(function* () {
    expect((yield* listing).find((tool) => tool.name === "forget")?.annotations).toMatchObject({
      title: "Forget",
      idempotentHint: false,
      openWorldHint: true,
    });
  }),
);
it("a tool has no success-schema override beside the entry", () => {
  const invalid = () =>
    defineWay({
      ...fixture.way,
      tools: [
        {
          entry: greet,
          title: "Greet",
          idempotent: true,
          openWorld: false,
          // @ts-expect-error Output has one owner, the node descriptor.
          success: Schema.Finite,
        },
      ],
    });
  expect(typeof invalid).toBe("function");
});
it("a tool has no failure-schema override beside the entry", () => {
  const invalid = () =>
    defineWay({
      ...fixture.way,
      tools: [
        {
          entry: greet,
          title: "Greet",
          idempotent: true,
          openWorld: false,
          // @ts-expect-error Failure has one owner, the node descriptor.
          failure: Schema.Unknown,
        },
      ],
    });
  expect(typeof invalid).toBe("function");
});
it.effect("optional extra configuration cannot replace the node's success schema", () =>
  Effect.gen(function* () {
    const maybe: { success?: typeof Schema.Finite } = {};
    expect(maybe.success).toBeUndefined();
    const result = yield* callMcpTool(fixture.handler, yield* session(), "greet", { name: "Ada" });
    expect(result.result?.["isError"]).toBe(false);
    expect(JSON.stringify(result.result)).toContain("Hello, Ada");
    expect(greet.node.output).toBe(Schema.String);
  }),
);
it("a union of way configuration choices keeps one success owner", () => {
  const project = (mode: "first" | "second") => ({ mode, entry: greet });
  expect(project("first").entry.node.output).toBe(project("second").entry.node.output);
  expectTypeOf(project("first").entry.node.output).toEqualTypeOf<typeof Schema.String>();
});
it("a union of way configuration choices keeps one failure owner", () => {
  const project = (mode: "first" | "second") => ({ mode, entry: greet });
  expect(project("first").entry.node.failure).toBe(NameIsEmpty);
  expectTypeOf(project("second").entry.node.failure).toEqualTypeOf<typeof NameIsEmpty>();
});
it("undefined has no second output schema to select", () => {
  expect(greet.node.output).toBe(Schema.String);
  if (fixture.way.protocol === "mcp") expect("success" in (fixture.way.tools[0] ?? {})).toBe(false);
});
it("entry failures retain real gate failures without a contract wrapper", () => {
  expectTypeOf<EntryFailure<typeof greet>>().toEqualTypeOf<NameIsEmpty | InnerFailure>();
  const ask = defineEntry(defineNode("ask", { ...greet.node, needsApproval: true }));
  expectTypeOf<Extract<EntryFailure<typeof ask>, ApprovalDenied>>().toEqualTypeOf<ApprovalDenied>();
  expectTypeOf<Extract<EntryFailure<typeof ask>, Forbidden>>().toEqualTypeOf<Forbidden>();
});
it.effect("an MCP node failure is kind-mapped and never leaks its tag", () =>
  Effect.gen(function* () {
    const result = yield* callMcpTool(fixture.handler, yield* session(), "greet", { name: "" });
    expect(result.result?.["isError"]).toBe(true);
    expect(JSON.stringify(result.result)).toContain("invalid");
    expect(JSON.stringify(result.result)).not.toContain("NameIsEmpty");
  }),
);
it.effect("NoInput is listed as an empty closed object", () =>
  Effect.gen(function* () {
    expect((yield* listing).find((tool) => tool.name === "ping")?.inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
    });
  }),
);
it.effect("the MCP router lists the projected entry with all its annotations", () =>
  Effect.gen(function* () {
    expect((yield* listing).find((tool) => tool.name === "ping")).toMatchObject({
      name: "ping",
      annotations: {
        title: "Ping",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
  }),
);
