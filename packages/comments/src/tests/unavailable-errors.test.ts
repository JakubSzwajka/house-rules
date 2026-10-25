import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { CommentStoreUnavailable, CommentTargetsUnavailable } from "../index.js";

it.effect("unavailable messages exclude driver details while causes remain inspectable", () =>
  Effect.sync(() => {
    const cause = new Error("private PostgreSQL host and query detail");
    for (const [error, message] of [
      [new CommentStoreUnavailable({ cause }), "Comments are unavailable. Try again shortly."],
      [
        new CommentTargetsUnavailable({ cause }),
        "Comment targets are unavailable. Try again shortly.",
      ],
    ] as const) {
      expect(error.kind).toBe("unavailable");
      expect(error.message).toBe(message);
      expect(error.message).not.toContain(cause.message);
      expect(error.cause).toBe(cause);
      expect(String(error.cause)).toContain(cause.message);
    }
  }),
);
