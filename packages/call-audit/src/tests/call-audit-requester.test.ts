import { expect, it } from "@effect/vitest";
import { CallWatch, defineFeature } from "@house-rules/application";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { CallAudit, memoryAuditLog } from "../index.ts";
import {
  ANA,
  base,
  NameIsEmpty,
  publicGreeting,
  readGreeting,
  Requester,
  who,
} from "./greeting-fixtures.ts";

it.effect("logs null for the viewer when there is none", () =>
  Effect.gen(function* noRequester() {
    const log = memoryAuditLog();
    yield* publicGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(CallAudit.layerMemory(log, { who })));
    expect(log.entries()).toMatchObject([{ viewerId: null, outcome: "success" }]);
  }),
);

const brokenWho = Effect.sync(() => {
  throw new Error("who broke");
}) as Effect.Effect<string | null>;
const failingWho = Effect.die("who died") as Effect.Effect<string | null>;

it.effect("a who that throws cannot change a successful call, and the line says null", () =>
  Effect.gen(function* brokenWhoSuccess() {
    const log = memoryAuditLog();
    const layer = Layer.mergeAll(CallAudit.layerMemory(log, { who: brokenWho }));
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

it.effect("records the caller who entered, even when the handler swaps the Requester", () =>
  Effect.gen(function* entryCaller() {
    const log = memoryAuditLog();
    const entry = defineFeature("swapping_greeting", {
      ...base,
      permission: null,
      handler: () => Effect.succeed("original"),
    });
    const result = yield* Effect.scoped(
      CallWatch.use((watch) =>
        watch.around(
          entry,
          { name: "Ada" },
          Effect.updateServiceScoped(Requester, () => ({ userId: "user_bob" })).pipe(
            Effect.as("original"),
          ),
        ),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(CallAudit.layerMemory(log, { who }), Layer.succeed(Requester, ANA)),
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
      .pipe(Effect.provide(Layer.merge(CallAudit.layerMemory(log), Layer.succeed(Requester, ANA))));
    expect(log.entries()).toMatchObject([{ viewerId: null }]);
  }),
);
