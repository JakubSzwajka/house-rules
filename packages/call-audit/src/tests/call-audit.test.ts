import { defineContract, Grant, implement, withRequestId } from "@house-rules/capability";
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  References,
  Result,
  Schema,
} from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { type AuditRow, CallAudit, memoryAuditLog, memoryAuditStore } from "../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
};

const greetHandler = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

const readGreeting = implement(
  defineContract("read_greeting", { ...base, permission: "greetings:read" }),
  greetHandler,
);
const publicGreeting = implement(
  defineContract("public_greeting", { ...base, permission: "public" }),
  greetHandler,
);
const explodingGreeting = implement(
  defineContract("exploding_greeting", { ...base, permission: "public" }),
  () => Effect.die("the handler blew up"),
);
const failThenCleanupDies = implement(
  defineContract("cleanup_dies_greeting", { ...base, permission: "public" }),
  () => Effect.fail(new NameIsEmpty()).pipe(Effect.ensuring(Effect.die("cleanup defect"))),
);
const chattyGreeting = implement(
  defineContract("chatty_greeting", { ...base, permission: "public" }),
  (input) => Effect.log("greeting someone").pipe(Effect.andThen(greetHandler(input))),
);
const stuckGreeting = implement(
  defineContract("stuck_greeting", { ...base, permission: "public" }),
  () => Effect.never,
);
const slowGreeting = implement(
  defineContract("slow_greeting", { ...base, permission: "public" }),
  (input) => Effect.sleep("50 millis").pipe(Effect.andThen(greetHandler(input))),
);

class Viewer extends Context.Service<Viewer, { readonly userId: string }>()("test/Viewer") {}

const ANA = { userId: "user_ana" };

const who = Effect.serviceOption(Viewer).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);

const audited = (log: ReturnType<typeof memoryAuditLog>) =>
  Layer.mergeAll(
    CallAudit.layerMemory(log, { who }),
    Layer.succeed(Viewer, ANA),
    Grant.layerFromPermissions(["greetings:read"]),
  );

it.effect("records a success with capability, permission, viewer and duration", () =>
  Effect.gen(function* recordsSuccess() {
    const log = memoryAuditLog();
    const fiber = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(audited(log)), Effect.forkChild);
    yield* TestClock.adjust("0 millis");
    expect(yield* Fiber.join(fiber)).toBe("Hello, Ada");
    expect(log.entries()).toEqual([
      {
        capability: "read_greeting",
        permission: "greetings:read",
        viewerId: "user_ana",
        outcome: "success",
        ms: 0,
        kind: "write",
        targetId: null,
        channel: "unknown",
        requestId: null,
      },
    ]);
  }),
);

it.effect("measures the whole call", () =>
  Effect.gen(function* measures() {
    const log = memoryAuditLog();
    const fiber = yield* slowGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(audited(log)), Effect.forkChild);
    yield* TestClock.adjust("50 millis");
    yield* Fiber.join(fiber);
    expect(log.entries().map((entry) => entry.ms)).toEqual([50]);
  }),
);

it.effect("records a typed failure by its tag and returns it unchanged", () =>
  Effect.gen(function* recordsFailure() {
    const log = memoryAuditLog();
    const error = yield* publicGreeting
      .handler({ name: "" })
      .pipe(Effect.provide(audited(log)), Effect.flip);
    expect(error).toBeInstanceOf(NameIsEmpty);
    expect(log.entries().map((entry) => entry.outcome)).toEqual(["NameIsEmpty"]);
  }),
);

it.effect("records Forbidden, and the handler never runs", () =>
  Effect.gen(function* recordsForbidden() {
    const log = memoryAuditLog();
    const error = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(
        Effect.provide(
          Layer.mergeAll(
            CallAudit.layerMemory(log, { who }),
            Layer.succeed(Viewer, ANA),
            Grant.denyAll,
          ),
        ),
        Effect.flip,
      );
    expect(error._tag).toBe("Forbidden");
    expect(log.entries()).toMatchObject([
      { capability: "read_greeting", viewerId: "user_ana", outcome: "Forbidden" },
    ]);
  }),
);

it.effect("records a defect and lets it through", () =>
  Effect.gen(function* recordsDefect() {
    const log = memoryAuditLog();
    const exit = yield* explodingGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(audited(log)), Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(false);
      const die = Cause.findDie(exit.cause);
      expect(Result.isSuccess(die) && die.success.defect).toBe("the handler blew up");
    }
    expect(log.entries().map((entry) => entry.outcome)).toEqual(["defect"]);
  }),
);

it.effect("records an interrupted call", () =>
  Effect.gen(function* recordsInterrupt() {
    const log = memoryAuditLog();
    const fiber = yield* stuckGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(audited(log)), Effect.forkChild);
    yield* TestClock.adjust("10 millis");
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(log.entries()).toMatchObject([{ outcome: "interrupted", ms: 10 }]);
  }),
);

it.effect("a defect beside a typed failure is recorded as a defect", () =>
  Effect.gen(function* mixedCause() {
    const log = memoryAuditLog();
    const exit = yield* failThenCleanupDies
      .handler({ name: "Ada" })
      .pipe(Effect.provide(audited(log)), Effect.exit);
    expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause) && Cause.hasDies(exit.cause)).toBe(
      true,
    );
    expect(log.entries().map((entry) => entry.outcome)).toEqual(["defect"]);
  }),
);

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

it.effect("logs null for the viewer when there is none", () =>
  Effect.gen(function* noViewer() {
    const log = memoryAuditLog();
    yield* publicGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(CallAudit.layerMemory(log, { who })));
    expect(log.entries()).toMatchObject([{ viewerId: null, outcome: "success" }]);
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

const brokenWho = Effect.sync(() => {
  throw new Error("who broke");
}) as Effect.Effect<string | null>;
const failingWho = Effect.die("who died") as Effect.Effect<string | null>;

it.effect("a who that throws cannot change a successful call, and the line says null", () =>
  Effect.gen(function* brokenWhoSuccess() {
    const log = memoryAuditLog();
    const layer = Layer.mergeAll(
      CallAudit.layerMemory(log, { who: brokenWho }),
      Grant.layerFromPermissions(["greetings:read"]),
    );
    const exit = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(layer), Effect.exit);
    expect(exit).toEqual(Exit.succeed("Hello, Ada"));
    expect(log.entries()).toMatchObject([{ viewerId: null, outcome: "success" }]);
  }),
);

it.effect("a who that dies leaves a typed failure the same failure", () =>
  Effect.gen(function* dyingWhoFailure() {
    const log = memoryAuditLog();
    const exit = yield* publicGreeting
      .handler({ name: "" })
      .pipe(Effect.provide(CallAudit.layerMemory(log, { who: failingWho })), Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(exit.cause.reasons).toHaveLength(1);
      const error = Cause.findError(exit.cause);
      expect(Result.isSuccess(error) && error.success).toBeInstanceOf(NameIsEmpty);
    }
    expect(log.entries()).toMatchObject([{ viewerId: null, outcome: "NameIsEmpty" }]);
  }),
);

it.effect("records the caller who entered, even when the handler swaps the Viewer", () =>
  Effect.gen(function* entryCaller() {
    const log = memoryAuditLog();
    const swapping = implement(
      defineContract("swapping_greeting", { ...base, permission: "public" }),
      () =>
        Effect.updateServiceScoped(Viewer, () => ({ userId: "user_bob" })).pipe(
          Effect.as("original"),
        ),
    );
    const result = yield* Effect.scoped(
      swapping
        .handler({ name: "Ada" })
        .pipe(
          Effect.provide(
            Layer.mergeAll(CallAudit.layerMemory(log, { who }), Layer.succeed(Viewer, ANA)),
          ),
        ),
    );
    expect(result).toBe("original");
    expect(log.entries()).toMatchObject([{ viewerId: "user_ana", outcome: "success" }]);
  }),
);

it.effect("a recorder that throws leaves the call's exit unchanged", () =>
  Effect.gen(function* brokenRecorder() {
    const log = memoryAuditLog();
    const broken = {
      ...log,
      record: () =>
        Effect.sync(() => {
          throw new Error("the recorder broke");
        }),
    };
    const exit = yield* publicGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(CallAudit.layerMemory(broken, { who })), Effect.exit);
    expect(exit).toEqual(Exit.succeed("Hello, Ada"));
  }),
);

it.effect("layerMemory without who logs null", () =>
  Effect.gen(function* defaultWho() {
    const log = memoryAuditLog();
    yield* publicGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(Layer.merge(CallAudit.layerMemory(log), Layer.succeed(Viewer, ANA))));
    expect(log.entries()).toMatchObject([{ viewerId: null }]);
  }),
);

it.effect("clear empties the memory log", () =>
  Effect.gen(function* clears() {
    const log = memoryAuditLog();
    yield* publicGreeting.handler({ name: "Ada" }).pipe(Effect.provide(CallAudit.layerMemory(log)));
    expect(log.entries()).toHaveLength(1);
    log.clear();
    expect(log.entries()).toEqual([]);
  }),
);
