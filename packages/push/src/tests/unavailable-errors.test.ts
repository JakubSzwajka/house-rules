import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { PushStoreUnavailable, PushSendFailed, PushOperations } from "../index.js";

it.effect("send failure constructors and old encoded failures default to no expiry facts", () =>
  Effect.gen(function* () {
    const cause = new Error("private provider details");
    const first = new PushSendFailed({ cause });
    const second = new PushSendFailed({ cause });
    expect(first.events).toEqual([]);
    expect(first.events).not.toBe(second.events);
    expect(first.cause).toBe(cause);
    expect(first.message).not.toContain(cause.message);
    const encoded = yield* Schema.encodeEffect(PushSendFailed)(first);
    const { events: _, ...legacy } = encoded;
    const decoded = yield* Schema.decodeEffect(PushOperations.deliver.failure)(legacy);
    expect(decoded).toBeInstanceOf(PushSendFailed);
    expect(decoded).toMatchObject({ events: [] });
    expect(decoded.message).toBe(first.message);
  }),
);

it.effect("unavailable messages hide causes", () =>
  Effect.sync(() => {
    const cause = new Error("private driver details");
    for (const [error, message] of [
      [
        new PushStoreUnavailable({ cause }),
        "Push subscriptions are unavailable. Try again shortly.",
      ],
      [new PushSendFailed({ cause }), "Push delivery is unavailable. Try again shortly."],
    ] as const) {
      expect(error.kind).toBe("unavailable");
      expect(error.message).toBe(message);
      expect(error.message).not.toContain(cause.message);
      expect(error.cause).toBe(cause);
    }
  }),
);
