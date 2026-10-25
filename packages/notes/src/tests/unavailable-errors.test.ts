import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { NoteStoreUnavailable, NoteTargetsUnavailable } from "../index.js";
it.effect("unavailable messages hide causes", () =>
  Effect.sync(() => {
    const cause = new Error("private driver details");
    for (const [error, message] of [
      [new NoteStoreUnavailable({ cause }), "Notes are unavailable. Try again shortly."],
      [new NoteTargetsUnavailable({ cause }), "Note targets are unavailable. Try again shortly."],
    ] as const) {
      expect(error.kind).toBe("unavailable");
      expect(error.message).toBe(message);
      expect(error.message).not.toContain(cause.message);
      expect(error.cause).toBe(cause);
    }
  }),
);
