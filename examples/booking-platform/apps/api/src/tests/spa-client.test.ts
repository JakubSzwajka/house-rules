import { afterAll, expect, it } from "@effect/vitest";
import { type CallEntry, HttpFailure, toPromiseClient } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";
import { app } from "../composition/index.js";
import { api } from "../delivery/http/api.js";
import { handler, web } from "../main.js";

afterAll(() => handler.dispose().then(app.dispose));

const clientWith = (calls: CallEntry[]) =>
  toPromiseClient(api, {
    baseUrl: "https://booking.example",
    fetch: (input, init) => web(new Request(input, init)),
    onCall: (entry) => calls.push(entry),
  });

it.live("the Promise client reads the demo booking through the real fetch handler", () =>
  Effect.gen(function* readsDemo() {
    const calls: CallEntry[] = [];
    const booking = yield* Effect.promise(() => clientWith(calls).showBooking({ id: "demo" }));
    expect(booking).toEqual({ id: "demo", guestName: "Ada Lovelace", status: "active" });
    expect(calls).toMatchObject([
      { name: "show_booking", method: "GET", path: "/api/bookings/demo", status: 200 },
    ]);
  }),
);

it.live("the Promise client gets the declared not_found code back, and onCall reports it", () =>
  Effect.gen(function* readsMissing() {
    const calls: CallEntry[] = [];
    const failure = yield* Effect.promise(() =>
      clientWith(calls)
        .showBooking({ id: "missing" })
        .then(
          () => "resolved",
          (error: unknown) => error,
        ),
    );
    expect(Schema.is(HttpFailure)(failure)).toBe(true);
    expect(failure).toMatchObject({
      code: "not_found",
      status: 404,
      body: { error: { code: "not_found", message: "Booking missing was not found." } },
    });
    expect(calls).toMatchObject([
      { path: "/api/bookings/missing", status: 404, code: "not_found" },
    ]);
  }),
);
