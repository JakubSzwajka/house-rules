import { expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, Random, References, Schema } from "effect";
import {
  type CallFacts,
  CallRequestId,
  CallWatch,
  defineContract,
  implement,
  NoInput,
  newRequestId,
  requestIdHeader,
  requestIdOf,
  withRequestId,
} from "../index.ts";

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
