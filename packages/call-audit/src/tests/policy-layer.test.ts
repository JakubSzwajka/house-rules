import { expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Layer, Logger, References } from "effect";
import { TestClock } from "effect/testing";
import {
  AuditStore,
  AuditStoreUnavailable,
  type AuditRow,
  CallAudit,
  classOf,
  memoryAuditStore,
} from "../index.ts";
import { asViewer, daysAgo, onWeb, readTrip, renameTrip, secret, who } from "./audit-fixtures.ts";

const trip = { tripId: "t-1", title: secret };

type Line = Readonly<{ level: string; message: string; annotations: object }>;

const capture = (lines: Array<Line>) =>
  Logger.layer([
    Logger.make(({ fiber, logLevel, message }) => {
      lines.push({
        level: logLevel,
        message: Array.isArray(message) ? message.join(" ") : String(message),
        annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
      });
    }),
  ]);

const brokenStore = Layer.succeed(
  AuditStore,
  AuditStore.of({
    record: () =>
      Effect.fail(new AuditStoreUnavailable({ message: `the disk is full near ${secret}` })),
    read: () => Effect.succeed([]),
    deleteExpired: () => Effect.succeed({ ran: true, deleted: { read: 0, write: 0, failure: 0 } }),
    erase: () => Effect.succeed(0),
  }),
);

const seedRow = (capability: string, ageInDays: number) =>
  Effect.map(
    daysAgo(ageInDays),
    (recordedAt): AuditRow => ({
      capability,
      permission: "public",
      viewerId: null,
      outcome: "success",
      ms: 1,
      kind: "write",
      targetId: null,
      channel: "web",
      requestId: null,
      recordedAt,
    }),
  );

it.effect("classOf: any failure is a failure, else the kind; a legacy row is a write", () =>
  Effect.sync(() => {
    expect(classOf({ outcome: "Forbidden", kind: "read" })).toBe("failure");
    expect(classOf({ outcome: "success", kind: "read" })).toBe("read");
    expect(classOf({ outcome: "success", kind: "write" })).toBe("write");
    expect(classOf({ outcome: "success", kind: null })).toBe("write");
  }),
);

it.effect("the presets match their documented behavior", () =>
  Effect.sync(() => {
    const { minimal, agentAware, strict } = CallAudit.presets;
    const days = (policy: typeof minimal) =>
      Object.values(policy.retention).map((window) =>
        Duration.toDays(Duration.fromInputUnsafe(window)),
      );
    expect(days(minimal)).toEqual([90, 90, 90]);
    expect(days(agentAware)).toEqual([365, 365, 365]);
    expect(days(strict)).toEqual([365, 365, 365]);
    expect([minimal, agentAware, strict].map((policy) => policy.onWriteFailure)).toEqual([
      "ignore",
      "log",
      "log",
    ]);
    expect([minimal, agentAware, strict].map((policy) => policy.erasure)).toEqual([
      "delete",
      "delete",
      "delete",
    ]);
  }),
);

it.effect("policy() starts from minimal and takes overrides", () =>
  Effect.sync(() => {
    const custom = CallAudit.policy({ onWriteFailure: "log" });
    expect(custom.retention).toEqual(CallAudit.presets.minimal.retention);
    expect(custom.keep).toBe(CallAudit.presets.minimal.keep);
    expect(custom.onWriteFailure).toBe("log");
  }),
);

it.effect("retention runs on start and then every interval", () =>
  Effect.gen(function* retentionTicks() {
    const rows: Array<AuditRow> = [yield* seedRow("expired_at_start", 100)];
    yield* Effect.scoped(
      Effect.gen(function* running() {
        yield* Layer.build(
          CallAudit.layer({
            who,
            policy: CallAudit.presets.minimal,
            retention: { interval: "10 minutes" },
          }).pipe(Layer.provide(memoryAuditStore(rows))),
        );
        yield* TestClock.adjust("1 millis");
        expect(rows).toEqual([]);
        rows.push(yield* seedRow("expired_later", 100));
        yield* TestClock.adjust("5 minutes");
        expect(rows.map((row) => row.capability)).toEqual(["expired_later"]);
        yield* TestClock.adjust("5 minutes");
        expect(rows).toEqual([]);
      }),
    );
  }),
);

it.effect("onWriteFailure log warns with the capability and error tag only", () =>
  Effect.gen(function* logsFailure() {
    const lines: Array<Line> = [];
    const result = yield* onWeb(renameTrip.handler(trip)).pipe(
      asViewer("user_ana"),
      Effect.provide(
        Layer.mergeAll(
          CallAudit.layer({ who, policy: CallAudit.presets.strict }).pipe(
            Layer.provide(brokenStore),
          ),
          capture(lines),
        ),
      ),
    );
    expect(result).toBe("t-1");
    const warnings = lines.filter((line) => line.level === "Warn");
    expect(warnings).toEqual([
      {
        level: "Warn",
        message: "call audit write failed",
        annotations: { capability: "rename_trip", error: "AuditStoreUnavailable" },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(secret);
  }),
);

it.effect("onWriteFailure ignore stays silent and leaves the call alone", () =>
  Effect.gen(function* ignoresFailure() {
    const lines: Array<Line> = [];
    const exit = yield* onWeb(renameTrip.handler(trip)).pipe(
      Effect.provide(
        Layer.mergeAll(
          CallAudit.layer({ who, policy: CallAudit.presets.minimal }).pipe(
            Layer.provide(brokenStore),
          ),
          capture(lines),
        ),
      ),
      Effect.exit,
    );
    expect(exit).toEqual(Exit.succeed("t-1"));
    expect(lines.filter((line) => line.level === "Warn")).toEqual([]);
  }),
);

it.effect("a keep that throws keeps the entry", () =>
  Effect.gen(function* brokenKeep() {
    const rows: Array<AuditRow> = [];
    const policy = CallAudit.policy({
      keep: () => {
        throw new Error("keep broke");
      },
    });
    yield* onWeb(readTrip.handler(trip)).pipe(
      Effect.provide(CallAudit.layer({ who, policy }).pipe(Layer.provide(memoryAuditStore(rows)))),
    );
    expect(rows.map((row) => row.capability)).toEqual(["read_trip"]);
  }),
);

it.effect("log: true writes the line only for the entries the policy keeps", () =>
  Effect.gen(function* logKept() {
    const lines: Array<Line> = [];
    const audit = Layer.mergeAll(
      CallAudit.layer({ who, policy: CallAudit.presets.minimal, log: true }).pipe(
        Layer.provide(memoryAuditStore()),
      ),
      capture(lines),
    );
    yield* onWeb(readTrip.handler(trip)).pipe(Effect.provide(audit));
    yield* onWeb(renameTrip.handler(trip)).pipe(Effect.provide(audit));
    const calls = lines.filter((line) => line.message.startsWith("capability call"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.message).toContain('"capability":"rename_trip"');
    expect(JSON.stringify(lines)).not.toContain(secret);
  }),
);
