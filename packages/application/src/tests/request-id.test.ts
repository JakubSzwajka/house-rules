import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Logger, Random, References, Schema } from "effect";
import {
  type CallFacts,
  CallRequestId,
  CallWatch,
  call,
  composition,
  defineContract,
  implement,
  NoInput,
  newRequestId,
  requestIdHeader,
  requestIdOf,
  toMcpHandler,
  tool,
  withRequestId,
} from "../index.ts";
import { mcpInitialize, mcpPost } from "./delivery-mcp-client.ts";

const loggingPing = implement(
  defineContract("ping", {
    description: "Answer pong.",
    input: NoInput,
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.log("inside the handler").pipe(Effect.as("pong")),
);

type Line = Readonly<{ message: unknown; annotations: Readonly<Record<string, unknown>> }>;

const capture = (lines: Array<Line>) =>
  Logger.layer([
    Logger.make(({ message, fiber }) => {
      lines.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
    }),
  ]);

const recordingWatch = (seen: Array<CallFacts>) =>
  Layer.succeed(CallWatch, {
    around: (_contract, _input, run, facts) =>
      Effect.andThen(
        Effect.sync(() => facts && seen.push(facts)),
        run,
      ),
  });

it("the header name is x-request-id", () => {
  expect(requestIdHeader).toBe("x-request-id");
});

it("requestIdOf keeps a safe id and rejects anything else", () => {
  for (const kept of ["req-42", "a", "A.b_c:d-9", "x".repeat(128), "0f3c9e1a"]) {
    expect(requestIdOf(kept)).toBe(kept);
  }
  for (const rejected of [
    "",
    "x".repeat(129),
    "has space",
    "new\nline",
    "semi;colon",
    "slash/path",
    "<script>",
    "ünïcode",
    null,
    undefined,
    42,
  ]) {
    expect(requestIdOf(rejected)).toBeNull();
  }
});

it.effect("newRequestId is 32 hex characters, safe, and fresh each time", () =>
  Effect.gen(function* fresh() {
    const ids = yield* Effect.all(Array.from({ length: 50 }, () => newRequestId));
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{32}$/u);
      expect(requestIdOf(id)).toBe(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  }),
);

it.effect("newRequestId follows a seeded Random, so a test can pin it", () =>
  Effect.gen(function* seeded() {
    const first = yield* newRequestId.pipe(Random.withSeed("seed"));
    const second = yield* newRequestId.pipe(Random.withSeed("seed"));
    expect(first).toBe(second);
  }),
);

it.effect("withRequestId sets the call's request id and annotates every log line inside", () =>
  Effect.gen(function* annotated() {
    const seen: Array<CallFacts> = [];
    const lines: Array<Line> = [];
    yield* Effect.log("before the call").pipe(
      Effect.andThen(loggingPing.handler({})),
      withRequestId("req-42"),
      Effect.provide(Layer.mergeAll(recordingWatch(seen), capture(lines))),
    );
    yield* Effect.log("outside the request").pipe(Effect.provide(capture(lines)));
    expect(seen.map((facts) => facts.requestId)).toEqual(["req-42"]);
    expect(lines).toEqual([
      { message: ["before the call"], annotations: { requestId: "req-42" } },
      { message: ["inside the handler"], annotations: { requestId: "req-42" } },
      { message: ["outside the request"], annotations: {} },
    ]);
  }),
);

it.effect("withRequestId works data-first, and an inner id wins over an outer one", () =>
  Effect.gen(function* nested() {
    const readId = Effect.service(CallRequestId);
    const inner = yield* withRequestId(readId, "inner").pipe(withRequestId("outer"));
    expect(inner).toBe("inner");
    expect(yield* CallRequestId).toBeNull();
  }),
);

const zeroRandom = Layer.succeed(Random.Random, {
  nextDoubleUnsafe: () => 0,
  nextIntUnsafe: () => 0,
});

const zeroId = "0".repeat(32);

const idPing = implement(
  defineContract("id_ping", {
    description: "Answer the request id.",
    input: NoInput,
    output: Schema.String,
    failure: Schema.Never,
    permission: "public",
  }),
  () =>
    Effect.gen(function* idOfCall() {
      return (yield* CallRequestId) ?? "none";
    }),
);

it.effect("a built app's Random makes the fresh request id on call() and MCP", () =>
  Effect.gen(function* seededAdapters() {
    const app = composition({ layer: zeroRandom, caller: () => Effect.succeed(Context.empty()) });
    const outcome = yield* Effect.promise(() =>
      call(app, idPing, {}, { headers: new Headers(), url: "https://a.test/" }),
    );
    expect(outcome).toEqual({ ok: true, value: zeroId });
    const mcp = toMcpHandler(app, {
      path: "/mcp",
      name: "t",
      version: "0",
      tools: [tool(idPing, { title: "Id", idempotent: true, openWorld: false })],
    });
    const init = yield* mcpPost(mcp, {}, mcpInitialize);
    expect(init.headers.get(requestIdHeader)).toBe(zeroId);
    yield* Effect.promise(() => mcp.dispose().then(app.dispose));
  }),
);
