import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PushStoreUnavailable, PushSendFailed } from "../index.js";

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
