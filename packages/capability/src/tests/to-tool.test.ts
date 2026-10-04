import { expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import { McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { defineContract, implement, NoInput, toTool } from "../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

class ToolProblem extends Schema.TaggedError<ToolProblem>()("ToolProblem", {
  message: Schema.String,
}) {}

const GreetInput = Schema.Struct({ name: Schema.String });

const greetContract = defineContract("greet", {
  description: "Greet someone by name.",
  input: GreetInput,
  output: Schema.String,
  failure: NameIsEmpty,
  annotations: { readOnly: true },
});

const forgetContract = defineContract("forget", {
  description: "Forget someone.",
  input: GreetInput,
  output: Schema.Void,
  failure: Schema.Never,
  annotations: { destructive: true },
});

const pingContract = defineContract("ping", {
  description: "Answer pong.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  annotations: { readOnly: true },
});

const mcpOnly = { title: "Greet", idempotent: true, openWorld: false };

const GreetTool = toTool(greetContract, mcpOnly);

it.effect("name, description and parameters come from the contract", () =>
  Effect.sync(() => {
    expect(GreetTool.name).toBe("greet");
    expect(GreetTool.description).toBe("Greet someone by name.");
    expect(GreetTool.parametersSchema).toBe(GreetInput);
    expect(GreetTool.successSchema).toBe(greetContract.output);
    expect(GreetTool.failureSchema).toBe(NameIsEmpty);
    expect(Tool.getJsonSchema(GreetTool)).toEqual(Schema.toJsonSchemaDocument(GreetInput).schema);
  }),
);

it.effect("keeps the precise contract types", () =>
  Effect.sync(() => {
    expectTypeOf(GreetTool.name).toEqualTypeOf<"greet">();
    expectTypeOf(GreetTool.parametersSchema).toEqualTypeOf<typeof GreetInput>();
    expectTypeOf(GreetTool.successSchema).toEqualTypeOf<typeof Schema.String>();
    expectTypeOf(GreetTool.failureSchema).toEqualTypeOf<typeof NameIsEmpty>();
  }),
);

it.effect("readOnly and destructive come from the contract annotations", () =>
  Effect.sync(() => {
    const ForgetTool = toTool(forgetContract, {
      title: "Forget",
      idempotent: false,
      openWorld: true,
    });

    expect(Context.get(GreetTool.annotations, Tool.Readonly)).toBe(true);
    expect(Context.get(GreetTool.annotations, Tool.Destructive)).toBe(false);
    expect(Context.get(ForgetTool.annotations, Tool.Readonly)).toBe(false);
    expect(Context.get(ForgetTool.annotations, Tool.Destructive)).toBe(true);
  }),
);

it.effect("title, idempotent and openWorld come from the options", () =>
  Effect.sync(() => {
    expect(Context.getUnsafe(GreetTool.annotations, Tool.Title)).toBe("Greet");
    expect(Context.get(GreetTool.annotations, Tool.Idempotent)).toBe(true);
    expect(Context.get(GreetTool.annotations, Tool.OpenWorld)).toBe(false);
  }),
);

it.effect("success and failure overrides replace the contract schemas", () =>
  Effect.sync(() => {
    const GreetingView = Schema.Struct({ text: Schema.String });
    const overridden = toTool(greetContract, {
      ...mcpOnly,
      success: GreetingView,
      failure: ToolProblem,
    });

    expect(overridden.successSchema).toBe(GreetingView);
    expect(overridden.failureSchema).toBe(ToolProblem);
    expect(overridden.parametersSchema).toBe(GreetInput);
    expectTypeOf(overridden.successSchema).toEqualTypeOf<typeof GreetingView>();
    expectTypeOf(overridden.failureSchema).toEqualTypeOf<typeof ToolProblem>();
  }),
);

it.effect("an override the options may omit is typed as either schema", () =>
  Effect.sync(() => {
    const maybeNumber: {
      title: string;
      idempotent: boolean;
      openWorld: boolean;
      success?: typeof Schema.Finite;
      failure?: typeof ToolProblem | undefined;
    } = mcpOnly;
    const optional = toTool(greetContract, maybeNumber);

    expect(optional.successSchema).toBe(Schema.String);
    expect(optional.failureSchema).toBe(NameIsEmpty);
    expectTypeOf(optional.successSchema).toEqualTypeOf<
      typeof Schema.Finite | typeof Schema.String
    >();
    expectTypeOf(optional.failureSchema).toEqualTypeOf<typeof ToolProblem | typeof NameIsEmpty>();
    expectTypeOf(optional.successSchema).not.toEqualTypeOf<typeof Schema.Finite>();
  }),
);

type UnionOptions = typeof mcpOnly &
  (
    | { mode: "contract" }
    | { mode: "view"; success: typeof Schema.Finite; failure: typeof ToolProblem }
  );

const projectUnion = (options: UnionOptions) => toTool(greetContract, options);

it.effect("a union of options types the success override of each member", () =>
  Effect.sync(() => {
    const view = projectUnion({
      ...mcpOnly,
      mode: "view",
      success: Schema.Finite,
      failure: ToolProblem,
    });
    const contract = projectUnion({ ...mcpOnly, mode: "contract" });

    expect(view.successSchema).toBe(Schema.Finite);
    expect(contract.successSchema).toBe(Schema.String);
    expectTypeOf(view.successSchema).toEqualTypeOf<typeof Schema.Finite | typeof Schema.String>();
    expectTypeOf(view.successSchema).not.toEqualTypeOf<typeof Schema.String>();
  }),
);

it.effect("a union of options types the failure override of each member", () =>
  Effect.sync(() => {
    const view = projectUnion({
      ...mcpOnly,
      mode: "view",
      success: Schema.Finite,
      failure: ToolProblem,
    });
    const contract = projectUnion({ ...mcpOnly, mode: "contract" });

    expect(view.failureSchema).toBe(ToolProblem);
    expect(contract.failureSchema).toBe(NameIsEmpty);
    expectTypeOf(view.failureSchema).toEqualTypeOf<typeof ToolProblem | typeof NameIsEmpty>();
    expectTypeOf(view.failureSchema).not.toEqualTypeOf<typeof NameIsEmpty>();
  }),
);

it.effect("an override set to undefined keeps the contract schema", () =>
  Effect.sync(() => {
    const unset = toTool(greetContract, { ...mcpOnly, success: undefined });

    expect(unset.successSchema).toBe(Schema.String);
    expectTypeOf(unset.successSchema).toEqualTypeOf<typeof Schema.String>();
  }),
);

it.effect("a NoInput contract renders as an object with no properties", () =>
  Effect.sync(() => {
    expect(Tool.getJsonSchema(toTool(pingContract, mcpOnly))).toEqual({
      type: "object",
      additionalProperties: false,
    });
  }),
);

const ping = implement(pingContract, () => Effect.succeed("pong"));

const PingTools = Toolkit.make(toTool(pingContract, { ...mcpOnly, title: "Ping" }));

const pingHandlers = PingTools.toLayer({ ping: () => ping.handler({}) });

it.layer(McpServer.McpServer.layer)("an MCP server", (test) => {
  test.effect("lists a projected tool with its annotations", () =>
    Effect.gen(function* listsProjectedTool() {
      yield* McpServer.registerToolkit(PingTools).pipe(Effect.provide(pingHandlers));
      const server = yield* McpServer.McpServer;

      expect(
        server.tools.map(({ tool }) => [tool.name, tool.inputSchema, tool.annotations]),
      ).toEqual([
        [
          "ping",
          { type: "object", additionalProperties: false },
          {
            title: "Ping",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        ],
      ]);
    }),
  );
});
