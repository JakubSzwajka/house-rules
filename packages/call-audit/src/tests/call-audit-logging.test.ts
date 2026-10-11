import { expect, it } from "@effect/vitest";
import { withRequestId, Grant } from "@house-rules/capability";
import { Effect, Exit, Layer, Logger, References, Result, Cause } from "effect";
import { TestConsole } from "effect/testing";
import { type AuditRow, CallAudit, memoryAuditLog, memoryAuditStore } from "../index.ts";
import {
  ANA,
  audited,
  chattyGreeting,
  NameIsEmpty,
  readGreeting,
  Viewer,
  who,
} from "./greeting-fixtures.ts";

const throwingLogger = Logger.layer([
  Logger.make(() => {
    throw new Error("the logger broke");
  }),
]);

const withBrokenLogger = Layer.mergeAll(
  CallAudit.layerLog({ who }),
  Layer.succeed(Viewer, ANA),
  Grant.layerFromPermissions(["greetings:read"]),
  throwingLogger,
);

it.effect("a logger that throws leaves a successful call successful", () =>
  Effect.gen(function* brokenLoggerSuccess() {
    const exit = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(withBrokenLogger), Effect.exit);
    expect(exit).toEqual(Exit.succeed("Hello, Ada"));
  }),
);

it.effect("a logger that throws leaves a typed failure the same failure", () =>
  Effect.gen(function* brokenLoggerFailure() {
    const exit = yield* readGreeting
      .handler({ name: "" })
      .pipe(Effect.provide(withBrokenLogger), Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(exit.cause.reasons).toHaveLength(1);
      const error = Cause.findError(exit.cause);
      expect(Result.isSuccess(error) && error.success).toBeInstanceOf(NameIsEmpty);
    }
  }),
);

it.effect("never keeps input values, in the entry or in the log line", () =>
  Effect.gen(function* keepsNoInput() {
    const log = memoryAuditLog();
    const lines: Array<unknown> = [];
    const capture = Logger.layer([
      Logger.make(({ message, fiber }) => {
        lines.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
      }),
    ]);
    const secret = "Secret honeymoon in Lisbon";
    yield* readGreeting
      .handler({ name: secret })
      .pipe(Effect.provide(Layer.mergeAll(audited(log), capture)));
    yield* readGreeting
      .handler({ name: secret })
      .pipe(
        Effect.provide(
          Layer.mergeAll(
            CallAudit.layerLog({ who }),
            Layer.succeed(Viewer, ANA),
            Grant.layerFromPermissions(["greetings:read"]),
            capture,
          ),
        ),
      );
    expect(Object.keys(log.entries()[0] ?? {}).sort()).toEqual([
      "capability",
      "channel",
      "kind",
      "ms",
      "outcome",
      "permission",
      "requestId",
      "targetId",
      "viewerId",
    ]);
    expect(JSON.stringify(log.entries())).not.toContain(secret);
    expect(JSON.stringify(lines)).not.toContain(secret);
  }),
);

it.effect("the production layer writes one physical line per call", () =>
  Effect.gen(function* oneLine() {
    yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(
        Effect.provide(
          Layer.mergeAll(
            CallAudit.layerLog({ who }),
            Layer.succeed(Viewer, ANA),
            Grant.layerFromPermissions(["greetings:read"]),
          ),
        ),
      );
    const written = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)];
    expect(written.every((part) => typeof part === "string" && !part.includes("\n"))).toBe(true);
    const rendered = written.join(" ");
    expect(rendered).toContain(
      'capability call {"capability":"read_greeting","permission":"greetings:read","viewerId":"user_ana","outcome":"success","ms":0,"kind":"write","targetId":null,"channel":"unknown","requestId":null}',
    );
    expect(rendered.match(/capability call/g)).toHaveLength(1);
  }).pipe(Effect.provide(TestConsole.layer)),
);

it.effect(
  "inside withRequestId, the stored row, the audit line and the handler's own log line carry the id",
  () =>
    Effect.gen(function* requestIdEverywhere() {
      const rows: Array<AuditRow> = [];
      const lines: Array<{ message: unknown; annotations: unknown }> = [];
      const capture = Logger.layer([
        Logger.make(({ message, fiber }) => {
          lines.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
        }),
      ]);
      const audit = CallAudit.layer({ who, policy: CallAudit.presets.strict, log: true }).pipe(
        Layer.provide(memoryAuditStore(rows)),
      );
      yield* chattyGreeting
        .handler({ name: "Ada" })
        .pipe(withRequestId("req-7"), Effect.provide(Layer.mergeAll(audit, capture)));
      expect(rows.map((row) => row.requestId)).toEqual(["req-7"]);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual({
        message: ["greeting someone"],
        annotations: { requestId: "req-7" },
      });
      expect(lines[1]?.annotations).toEqual({ requestId: "req-7" });
      expect(String(lines[1]?.message)).toContain('"requestId":"req-7"');
    }),
);
