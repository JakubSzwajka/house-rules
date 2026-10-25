import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  type Around,
  CallChannel,
  type CallFacts,
  CallRequestId,
  CallWatch,
  isMcpChannel,
  mcpChannel,
  unknownCallFacts,
} from "../index.ts";
import { bindFixture, runFixture } from "./execution-fixtures.ts";
import { mcpFixture } from "./router-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";
const TripInput = Schema.Struct({
  tripId: Schema.String,
  nights: Schema.Finite,
  note: Schema.optional(Schema.String),
});
const readTrip = bindFixture(
  featureFixture(
    defineOperation("read_trip", {
      description: "Read a trip.",
      input: TripInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  ({ tripId }) => Effect.succeed(tripId),
);
const renameTrip = bindFixture(
  featureFixture(
    defineOperation("rename_trip", {
      description: "Rename a trip.",
      input: TripInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: null,
    }),
  ),
  ({ tripId }) => Effect.succeed(tripId),
);
const ping = bindFixture(
  featureFixture(
    defineOperation("ping", {
      description: "Answer pong.",
      input: NoInput,
      output: Schema.String,
      failure: Schema.Never,
      permission: null,
    }),
  ),
  () => Effect.succeed("pong"),
);
const recordingWatch = (seen: CallFacts[]) =>
  Layer.succeed(CallWatch, {
    around: ((_feature, _input, run, facts) =>
      Effect.sync(() => {
        if (facts !== undefined) seen.push(facts);
      }).pipe(Effect.andThen(run))) satisfies Around,
  });
it.effect("a read-only feature is a read and any other feature is a write", () =>
  Effect.gen(function* () {
    const seen: CallFacts[] = [];
    yield* runFixture(readTrip, { tripId: "t-1", nights: 2 }).pipe(
      Effect.provide(recordingWatch(seen)),
    );
    yield* runFixture(renameTrip, { tripId: "t-1", nights: 2 }).pipe(
      Effect.provide(recordingWatch(seen)),
    );
    expect(seen.map((facts) => facts.kind)).toEqual(["read", "write"]);
  }),
);
it.effect("the target is always the feature name, never an input value", () =>
  Effect.gen(function* () {
    const seen: CallFacts[] = [];
    const watch = recordingWatch(seen);
    yield* runFixture(readTrip, { tripId: "t-1", nights: 2 }).pipe(Effect.provide(watch));
    yield* runFixture(renameTrip, { tripId: "t-1", nights: 2 }).pipe(Effect.provide(watch));
    yield* runFixture(renameTrip, { tripId: "t-1", nights: 2, note: "n-9" }).pipe(
      Effect.provide(watch),
    );
    yield* runFixture(ping, {}).pipe(Effect.provide(watch));
    expect(seen.map((facts) => facts.target)).toEqual([
      "read_trip",
      "rename_trip",
      "rename_trip",
      "ping",
    ]);
    expect(seen.map((facts) => facts.targetId)).toEqual([null, null, null, null]);
  }),
);
it.effect("a long input id is never copied into feature facts", () =>
  Effect.gen(function* () {
    const seen: CallFacts[] = [];
    yield* runFixture(readTrip, { tripId: "x".repeat(1000), nights: 1 }).pipe(
      Effect.provide(recordingWatch(seen)),
    );
    expect(seen[0]?.target).toBe("read_trip");
    expect(seen[0]?.targetId).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("xxx");
  }),
);
it.effect("channel defaults to unknown and request id to null", () =>
  Effect.gen(function* () {
    const seen: CallFacts[] = [];
    yield* runFixture(ping, {}).pipe(Effect.provide(recordingWatch(seen)));
    expect(seen).toEqual([
      { kind: "write", target: "ping", targetId: null, channel: "unknown", requestId: null },
    ]);
  }),
);
it.effect("the edge can set its channel and request id", () =>
  Effect.gen(function* () {
    const seen: CallFacts[] = [];
    yield* runFixture(ping, {}).pipe(
      Effect.provide(recordingWatch(seen)),
      Effect.provideService(CallChannel, "web"),
      Effect.provideService(CallRequestId, "req-42"),
    );
    expect(seen[0]).toMatchObject({ channel: "web", requestId: "req-42" });
  }),
);
it("callables have no free-text or input-field audit declaration", () => {
  const invalid = () =>
    defineOperation("bad_audit", {
      ...ping,
      // @ts-expect-error Feature facts do not read an input field.
      audit: { target: "note" },
    });
  expect(typeof invalid).toBe("function");
  expect("audit" in readTrip).toBe(false);
});
it("mcpChannel keeps a short plain client name", () => {
  expect(mcpChannel(undefined)).toBe("mcp");
  expect(mcpChannel("  ")).toBe("mcp");
  expect(mcpChannel("claude-code")).toBe("mcp:claude-code");
  expect(mcpChannel("evil\nname\u0000{}")).toBe("mcp:evilname");
  expect(mcpChannel("a".repeat(200))).toBe(`mcp:${"a".repeat(40)}`);
  expect(isMcpChannel("mcp")).toBe(true);
  expect(isMcpChannel("mcp:claude-code")).toBe(true);
  expect(isMcpChannel("web")).toBe(false);
});
const seenMcp: CallFacts[] = [];
const fixture = mcpFixture([readTrip], {
  tools: [{ feature: readTrip, title: "Read trip", idempotent: true, openWorld: false }],
  extra: Layer.merge(recordingWatch(seenMcp), Layer.succeed(CallChannel, "web")),
});
afterAll(fixture.dispose);
it.effect("an MCP call uses its client name over the app's channel", () =>
  Effect.gen(function* () {
    const session = yield* openMcpSession(fixture.handler, {
      authorization: "Bearer fixture",
      "x-request-id": "mcp-facts",
    });
    const result = yield* callMcpTool(fixture.handler, session, "read_trip", {
      tripId: "t-5",
      nights: 1,
    });
    expect(result.result?.["isError"]).toBe(false);
    expect(seenMcp).toEqual([
      {
        kind: "read",
        target: "read_trip",
        targetId: null,
        channel: "mcp:test-client",
        requestId: "mcp-facts",
      },
    ]);
  }),
);
it.effect("three-argument Around functions remain valid lower slots", () =>
  Effect.gen(function* () {
    const watch = yield* CallWatch;
    expect(yield* watch.around(ping, {}, Effect.succeed("ok"))).toBe("ok");
    const simple: Around = (_feature, _input, run) => run;
    expect(yield* simple(ping, {}, Effect.succeed("still"))).toBe("still");
    expect(unknownCallFacts(readTrip)).toEqual({
      kind: "read",
      target: "read_trip",
      targetId: null,
      channel: "unknown",
      requestId: null,
    });
    expect(unknownCallFacts(ping).kind).toBe("write");
  }),
);
