import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Toolkit } from "effect/unstable/ai";
import {
  type Around,
  CallChannel,
  type CallFacts,
  CallRequestId,
  CallWatch,
  defineContract,
  implement,
  isMcpChannel,
  maxTargetIdLength,
  mcpChannel,
  NoInput,
  toTool,
  unknownCallFacts,
} from "../index.ts";

const TripInput = Schema.Struct({
  tripId: Schema.String,
  nights: Schema.Finite,
  note: Schema.optional(Schema.String),
});

const readTrip = implement(
  defineContract("read_trip", {
    description: "Read a trip.",
    input: TripInput,
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
    annotations: { readOnly: true },
    audit: { target: "tripId" },
  }),
  ({ tripId }) => Effect.succeed(tripId),
);

const renameTrip = implement(
  defineContract("rename_trip", {
    description: "Rename a trip.",
    input: TripInput,
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
    audit: { target: "note" },
  }),
  ({ tripId }) => Effect.succeed(tripId),
);

const ping = implement(
  defineContract("ping", {
    description: "Answer pong.",
    input: NoInput,
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.succeed("pong"),
);

const recordingWatch = (seen: Array<CallFacts>) =>
  Layer.succeed(CallWatch, {
    around: ((_contract, _input, run, facts) =>
      Effect.andThen(
        Effect.sync(() => facts && seen.push(facts)),
        run,
      )) satisfies Around,
  });

it.effect("a read-only contract is a read, any other a write", () =>
  Effect.gen(function* kinds() {
    const seen: Array<CallFacts> = [];
    yield* readTrip
      .handler({ tripId: "t-1", nights: 2 })
      .pipe(Effect.provide(recordingWatch(seen)));
    yield* renameTrip
      .handler({ tripId: "t-1", nights: 2 })
      .pipe(Effect.provide(recordingWatch(seen)));
    expect(seen.map((facts) => facts.kind)).toEqual(["read", "write"]);
  }),
);

it.effect("the target is the declared input field, only when its value is a string", () =>
  Effect.gen(function* targets() {
    const seen: Array<CallFacts> = [];
    const watch = recordingWatch(seen);
    yield* readTrip.handler({ tripId: "t-1", nights: 2 }).pipe(Effect.provide(watch));
    yield* renameTrip.handler({ tripId: "t-1", nights: 2 }).pipe(Effect.provide(watch));
    yield* renameTrip
      .handler({ tripId: "t-1", nights: 2, note: "n-9" })
      .pipe(Effect.provide(watch));
    yield* ping.handler({}).pipe(Effect.provide(watch));
    expect(seen.map((facts) => facts.targetId)).toEqual(["t-1", null, "n-9", null]);
  }),
);

it.effect("a long target is capped", () =>
  Effect.gen(function* capped() {
    const seen: Array<CallFacts> = [];
    yield* readTrip
      .handler({ tripId: "x".repeat(1000), nights: 1 })
      .pipe(Effect.provide(recordingWatch(seen)));
    expect(seen[0]?.targetId).toHaveLength(maxTargetIdLength);
  }),
);

it.effect("the channel defaults to unknown and the request id to null", () =>
  Effect.gen(function* defaults() {
    const seen: Array<CallFacts> = [];
    yield* ping.handler({}).pipe(Effect.provide(recordingWatch(seen)));
    expect(seen).toEqual([{ kind: "write", targetId: null, channel: "unknown", requestId: null }]);
  }),
);

it.effect("an app sets the channel and the request id", () =>
  Effect.gen(function* appSets() {
    const seen: Array<CallFacts> = [];
    yield* ping
      .handler({})
      .pipe(
        Effect.provide(recordingWatch(seen)),
        Effect.provideService(CallChannel, "web"),
        Effect.provideService(CallRequestId, "req-42"),
      );
    expect(seen[0]).toMatchObject({ channel: "web", requestId: "req-42" });
  }),
);

it.effect("the audit target must name a string field of the input", () =>
  Effect.sync(() => {
    const base = {
      description: "A contract.",
      input: TripInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: "public",
    } as const;
    // @ts-expect-error nights is a number, not a string id
    defineContract("bad_number", { ...base, audit: { target: "nights" } });
    // @ts-expect-error the input has no such field
    defineContract("bad_missing", { ...base, audit: { target: "missing" } });
    expect(defineContract("good", { ...base, audit: { target: "tripId" } }).audit).toEqual({
      target: "tripId",
    });
    expect(defineContract("none", base).audit).toBeUndefined();
  }),
);

it.effect("mcpChannel keeps a short, plain client name", () =>
  Effect.sync(() => {
    expect(mcpChannel(undefined)).toBe("mcp");
    expect(mcpChannel("  ")).toBe("mcp");
    expect(mcpChannel("claude-code")).toBe("mcp:claude-code");
    expect(mcpChannel("evil\nname\u0000{}")).toBe("mcp:evilname");
    expect(mcpChannel("a".repeat(200))).toBe(`mcp:${"a".repeat(40)}`);
    expect(isMcpChannel("mcp")).toBe(true);
    expect(isMcpChannel("mcp:claude-code")).toBe(true);
    expect(isMcpChannel("web")).toBe(false);
  }),
);

const ReadTripTools = Toolkit.make(
  toTool(readTrip.contract, { title: "Read trip", idempotent: true, openWorld: false }),
);

const client = (name: string) =>
  McpSchema.McpServerClient.of({
    clientId: 1,
    protocolVersion: "2025-11-25",
    clientCapabilities: new McpSchema.ClientCapabilities({}),
    clientInfo: { name, version: "1.0.0" },
    initializePayload: {
      protocolVersion: "2025-11-25",
      capabilities: new McpSchema.ClientCapabilities({}),
      clientInfo: { name, version: "1.0.0" },
    },
    getClient: Effect.die("getClient is not used"),
  });

it.layer(McpServer.McpServer.layer)("a tool projected with toTool", (test) => {
  test.effect("runs on the mcp channel with the client name, over the app's channel", () =>
    Effect.gen(function* mcpCall() {
      const seen: Array<CallFacts> = [];
      const handlers = ReadTripTools.toLayer({
        read_trip: (input) => readTrip.handler(input),
      });
      yield* McpServer.registerToolkit(ReadTripTools).pipe(
        Effect.provide(Layer.merge(handlers, recordingWatch(seen))),
        Effect.provideService(CallChannel, "web"),
      );
      const server = yield* McpServer.McpServer;
      const result = yield* server
        .callTool({ name: "read_trip", arguments: { tripId: "t-5", nights: 1 } })
        .pipe(Effect.provideService(McpSchema.McpServerClient, client("claude-code")));
      expect(result.isError).not.toBe(true);
      expect(seen).toEqual([
        { kind: "read", targetId: "t-5", channel: "mcp:claude-code", requestId: null },
      ]);
    }),
  );
});

it.effect("a 3-argument around call and a 3-argument watch still compile and run", () =>
  Effect.gen(function* additive() {
    const watch = yield* CallWatch;
    // Additive API: callers written before facts existed pass three arguments.
    expect(yield* watch.around(ping.contract, {}, Effect.succeed("ok"))).toBe("ok");
    const old: Around = (_contract, _input, run) => run;
    expect(yield* old(ping.contract, {}, Effect.succeed("still"))).toBe("still");
    expect(unknownCallFacts(readTrip.contract)).toEqual({
      kind: "read",
      targetId: null,
      channel: "unknown",
      requestId: null,
    });
    expect(unknownCallFacts(ping.contract).kind).toBe("write");
  }),
);
