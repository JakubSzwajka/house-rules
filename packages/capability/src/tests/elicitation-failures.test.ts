import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { McpSchema } from "effect/unstable/ai";
import { captureLogs, formClient, type LogLine, runShare } from "./elicitation-fixtures.ts";

const probe = "privacy-probe@example.invalid";

const run = (answer: Parameters<typeof runShare>[0]["answer"], lines: Array<LogLine> = []) =>
  Effect.flip(
    runShare({ answer, capabilities: formClient }, [], []).pipe(Effect.provide(captureLogs(lines))),
  );

const malformed = (value: unknown) => Effect.succeed(value as McpSchema.ElicitResult);

it.effect("a failed request reports only the error tag, not its text", () =>
  Effect.gen(function* requestFails() {
    const lines: Array<LogLine> = [];
    const error = yield* run(
      Effect.fail(
        new McpSchema.McpReverseOperationUnsupported({
          operation: "elicitation/create",
          protocolVersion: "2025-11-25",
          reason: `not negotiated for ${probe}`,
        }),
      ),
      lines,
    );

    expect(error.reason).toBe("Approval request failed (McpReverseOperationUnsupported)");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.annotations).toMatchObject({ reason: error.reason });
    expect(JSON.stringify([error, lines])).not.toContain(probe);
  }),
);

it.effect("a failure with a message and no tag reports no text", () =>
  Effect.gen(function* plainError() {
    const lines: Array<LogLine> = [];
    const error = yield* run(Effect.fail({ message: probe }) as never, lines);

    expect(error.reason).toBe("Approval request failed");
    expect(JSON.stringify([error, lines])).not.toContain(probe);
  }),
);

it.effect("a defect reports its class name, not its message", () =>
  Effect.gen(function* defects() {
    const lines: Array<LogLine> = [];
    const error = yield* run(Effect.die(new TypeError(`transport echoed ${probe}`)), lines);

    expect(error.reason).toBe("Approval request failed (TypeError)");
    expect(lines).toHaveLength(1);
    expect(JSON.stringify([error, lines])).not.toContain(probe);
  }),
);

it.effect("a defect that is not an object, or has an unsafe name, reports no text", () =>
  Effect.gen(function* oddDefects() {
    const text = yield* run(Effect.die(`echo ${probe}`));
    const unsafe = yield* run(Effect.die({ _tag: `Bad Tag ${probe}` }));
    const long = yield* run(Effect.die({ _tag: "A".repeat(41) }));

    expect(text.reason).toBe("Approval request failed");
    expect(unsafe.reason).toBe("Approval request failed");
    expect(long.reason).toBe("Approval request failed");
  }),
);

it.effect("an unexpected action fails closed as malformed", () =>
  Effect.gen(function* maybe() {
    const lines: Array<LogLine> = [];
    const error = yield* run(malformed({ action: "maybe" }), lines);

    expect(error.reason).toBe("Approval answer was malformed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "Warn",
      annotations: { outcome: "denied", reason: "Approval answer was malformed" },
    });
  }),
);

it.effect("a null, string, or action-less result is malformed, not a defect", () =>
  Effect.gen(function* nonObjects() {
    for (const value of [null, undefined, "accept", 7, {}, { action: 1 }]) {
      const lines: Array<LogLine> = [];
      const error = yield* run(malformed(value), lines);

      expect(error.reason).toBe("Approval answer was malformed");
      expect(lines).toHaveLength(1);
      expect(lines[0]?.annotations).toMatchObject({ outcome: "denied" });
    }
  }),
);
