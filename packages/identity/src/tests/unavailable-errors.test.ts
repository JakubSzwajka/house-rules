import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { IdentityStoreUnavailable } from "../index.js";

it.effect("unavailable messages exclude driver details while causes remain inspectable", () =>
  Effect.sync(() => {
    const cause = new Error("private PostgreSQL host and query detail");
    const error = new IdentityStoreUnavailable({ cause });
    expect(error.kind).toBe("unavailable");
    expect(error.message).toBe("Login bindings are unavailable. Try again shortly.");
    expect(error.message).not.toContain(cause.message);
    expect(error.cause).toBe(cause);
    expect(String(error.cause)).toContain(cause.message);
  }),
);
