import { expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { defineContract, Grant, implement, toTool } from "../index.ts";

class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {}) {}

const ById = Schema.Struct({ by: Schema.Literal("id"), bookingId: Schema.String });
const ByGuest = Schema.Struct({
  by: Schema.Literal("guest"),
  guest: Schema.String,
  nights: Schema.optionalKey(Schema.FiniteFromString),
});
const FindInput = Schema.Union([ById, ByGuest]);

type Find = typeof FindInput.Type;

const findContract = defineContract("find_booking", {
  description: "Find a booking by its id or by its guest.",
  input: FindInput,
  output: Schema.String,
  failure: BookingNotFound,
  permission: "bookings:read",
  annotations: { readOnly: true },
  audit: { target: "by" },
});

const describeFind = (input: Find): string =>
  input.by === "id" ? `id ${input.bookingId}` : `guest ${input.guest} ${input.nights ?? "-"}`;

const find = implement(findContract, (input) => Effect.succeed(describeFind(input)));

const grantAll = Layer.succeed(Grant, Grant.of({ holds: () => Effect.succeed(true) }));

const greetContract = defineContract("greet", {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

const greet = implement(greetContract, ({ name }) => Effect.succeed(`Hello, ${name}`));

const mcpOnly = { title: "Find booking", idempotent: true, openWorld: false };

const FindTool = toTool(findContract, mcpOnly);

const mergedProperties = {
  by: { type: "string", enum: ["id", "guest"] },
  bookingId: { type: "string" },
  guest: { type: "string" },
  nights: { type: "string" },
};

it.effect("a Union contract hands its handler one decoded member", () =>
  Effect.gen(function* unionHandler() {
    expectTypeOf(findContract.input).toEqualTypeOf<typeof FindInput>();
    expectTypeOf<Parameters<typeof find.handler>[0]>().toEqualTypeOf<Find>();
    expect(yield* find.handler({ by: "id", bookingId: "b-1" })).toBe("id b-1");
    expect(yield* find.handler({ by: "guest", guest: "Ada", nights: 2 })).toBe("guest Ada 2");
  }).pipe(Effect.provide(grantAll)),
);

it.effect("toTool shows a Union as one object: shared keys required, the tag an enum", () =>
  Effect.sync(() => {
    expect(Tool.getJsonSchema(FindTool)).toMatchObject({
      type: "object",
      properties: mergedProperties,
      required: ["by"],
    });
    expectTypeOf(FindTool.parametersSchema.Type).toEqualTypeOf<Find>();
    expectTypeOf(FindTool.parametersSchema.Encoded).toEqualTypeOf<{
      readonly by: "id" | "guest";
      readonly bookingId?: string;
      readonly guest?: string;
      readonly nights?: string;
    }>();
    expect(Context.get(FindTool.annotations, Tool.Strict)).toBe(true);
  }),
);

it.effect("the merged parameters decode to the member the input fits", () =>
  Effect.gen(function* mergedDecode() {
    const decode = Schema.decodeUnknownEffect(FindTool.parametersSchema);
    expect(yield* decode({ by: "guest", guest: "Ada", nights: "3" })).toEqual({
      by: "guest",
      guest: "Ada",
      nights: 3,
    });
    expect(yield* decode({ by: "id", bookingId: "b-1" })).toEqual({ by: "id", bookingId: "b-1" });
    const misfit = yield* Effect.flip(decode({ by: "guest", bookingId: "b-1" }));
    expect(misfit.message).toContain('["guest"]');
  }),
);

it.effect("a Struct contract keeps its own input as the tool parameters", () =>
  Effect.sync(() => {
    const GreetTool = toTool(greetContract, { ...mcpOnly, title: "Greet" });
    expect(GreetTool.parametersSchema).toBe(greetContract.input);
    expectTypeOf(GreetTool.parametersSchema).toEqualTypeOf<typeof greetContract.input>();
    expect(Context.get(GreetTool.annotations, Tool.Strict)).toBe(true);
  }),
);

const Tools = Toolkit.make(
  FindTool,
  toTool(greetContract, { title: "Greet", idempotent: true, openWorld: false }),
);

const toolsServer = McpServer.toolkit(Tools).pipe(
  Layer.provide(
    Tools.toLayer({
      find_booking: (input) => find.handler(input).pipe(Effect.provide(grantAll)),
      greet: (input) => greet.handler(input),
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

it.layer(toolsServer)("an MCP server with a Union tool", (test) => {
  test.effect("runs the handler with the member the arguments fit", () =>
    Effect.gen(function* fits() {
      const byGuest = yield* call("find_booking", { by: "guest", guest: "Ada", nights: "4" });
      const byId = yield* call("find_booking", { by: "id", bookingId: "b-9" });
      expect([byGuest.isError, byGuest.structuredContent]).toEqual([false, "guest Ada 4"]);
      expect([byId.isError, byId.structuredContent]).toEqual([false, "id b-9"]);
    }),
  );

  test.effect("refuses arguments that fit the merged object but no member", () =>
    Effect.gen(function* misfit() {
      const error = yield* Effect.flip(call("find_booking", { by: "guest" }));
      expect(error).toBeInstanceOf(McpSchema.InvalidParams);
      expect(error.message).toContain('["guest"]');
    }),
  );

  test.effect("refuses keys the input does not take, for Union and Struct tools", () =>
    Effect.gen(function* unknownKeys() {
      const fromOtherMember = yield* Effect.flip(
        call("find_booking", { by: "id", bookingId: "b-1", guest: "Ada" }),
      );
      const unknownToUnion = yield* Effect.flip(
        call("find_booking", { by: "id", bookingId: "b-1", admin: true }),
      );
      const unknownToStruct = yield* Effect.flip(call("greet", { name: "Ada", admin: true }));
      for (const error of [fromOtherMember, unknownToUnion, unknownToStruct]) {
        expect(error).toBeInstanceOf(McpSchema.InvalidParams);
        expect(error.message).toContain("Expected no excess property");
      }
    }),
  );

  test.effect("lists the merged object, closed to other keys, as the tool's input schema", () =>
    Effect.gen(function* lists() {
      const server = yield* McpServer.McpServer;
      const listed = server.tools.find(({ tool }) => tool.name === "find_booking");
      expect(listed?.tool.inputSchema).toEqual({
        type: "object",
        properties: mergedProperties,
        required: ["by"],
        additionalProperties: false,
      });
    }),
  );
});
