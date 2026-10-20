import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { admit, call, type CallOptions } from "../index.ts";
import { makeApp, sessionWhoFor, showBooking } from "./delivery-fixtures.ts";

const t = makeApp({ who: "session" });
afterAll(t.dispose);

const incoming = {
  headers: new Headers({ cookie: "session=s-ada", "x-request-id": "admit-1" }),
  url: "/bookings",
};

const internal = {
  ok: false,
  error: undefined,
  view: {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong on the server." } },
  },
};

it.effect(
  "call() rejects caller and admitted together without running either caller or capability",
  () =>
    Effect.gen(function* conflictingAdmission() {
      const auth = yield* Effect.promise(() => admit(t.app, incoming, { way: "api" }));
      if (!auth.ok) return expect.unreachable();
      const before = { ...t.work };
      const start = t.logs.length;
      let customCallerRan = false;
      const options = {
        way: "api",
        admitted: auth.value,
        caller: (request: typeof incoming) => {
          customCallerRan = true;
          return sessionWhoFor(t.work).resolve(request);
        },
      } as unknown as CallOptions;
      expect(
        yield* Effect.promise(() => call(t.app, showBooking, { id: "b-1" }, incoming, options)),
      ).toEqual(internal);
      expect(customCallerRan).toBe(false);
      expect(t.work).toEqual(before);
      expect(t.logs.slice(start)).toContainEqual(
        expect.objectContaining({
          message: expect.arrayContaining(["Call failed"]),
          annotations: expect.objectContaining({
            requestId: "admit-1",
          }),
        }),
      );
    }),
);
