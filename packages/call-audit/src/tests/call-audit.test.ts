import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { CallAudit, memoryAuditLog } from "../index.ts";
import {
  ANA,
  audited,
  explodingGreeting,
  failThenCleanupDies,
  NameIsEmpty,
  publicGreeting,
  readGreeting,
  slowGreeting,
  stuckGreeting,
  Requester,
  who,
} from "./greeting-fixtures.ts";

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
        target: "read_greeting",
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
      .handler({ name: "Ada" }, [])
      .pipe(
        Effect.provide(
          Layer.mergeAll(CallAudit.layerMemory(log, { who }), Layer.succeed(Requester, ANA)),
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

it.effect("clear empties the memory log", () =>
  Effect.gen(function* clears() {
    const log = memoryAuditLog();
    yield* publicGreeting.handler({ name: "Ada" }).pipe(Effect.provide(CallAudit.layerMemory(log)));
    expect(log.entries()).toHaveLength(1);
    log.clear();
    expect(log.entries()).toEqual([]);
  }),
);
