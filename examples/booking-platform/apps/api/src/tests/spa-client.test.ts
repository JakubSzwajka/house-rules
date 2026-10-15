import { afterAll, expect, it } from "@effect/vitest";
import { type CallEntry, HttpFailure, toPromiseClient } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";
import { app } from "../composition/index.js";
import { api, publicApi, tokenApi } from "../delivery/http/api.js";
import { handler } from "../main.js";

afterAll(() => handler.dispose().then(app.dispose));

const baseUrl = "https://booking.example";
const fetch = (input: string | URL | Request, init?: RequestInit) =>
  handler(new Request(input, init));
const browserFetch = (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  request.headers.set("origin", baseUrl);
  return handler(request);
};
const visitor = toPromiseClient(publicApi, { baseUrl, fetch: browserFetch });
const tokens = toPromiseClient(tokenApi, { baseUrl, fetch });
const credentials = { email: "spa@example.test", password: "a long enough secret" };
const ignored = () => undefined;

const signedIn = Effect.promise(() =>
  visitor
    .signUp({ ...credentials, displayName: "Spa" })
    .then(ignored, ignored)
    .then(() => tokens.signIn(credentials)),
);

const clientWith = (calls: CallEntry[], token: string) =>
  toPromiseClient(api, {
    baseUrl,
    fetch,
    token: () => token,
    onCall: (entry) => calls.push(entry),
  });

it.live("the Promise client reads the demo booking through the real fetch handler", () =>
  Effect.gen(function* readsDemo() {
    const calls: CallEntry[] = [];
    const { token } = yield* signedIn;
    const booking = yield* Effect.promise(() =>
      clientWith(calls, token).showBooking({ id: "demo" }),
    );
    expect(booking).toEqual({ id: "demo", guestName: "Ada Lovelace", status: "active" });
    expect(calls).toMatchObject([
      { name: "show_booking", method: "GET", path: "/api/bookings/demo", status: 200 },
    ]);
  }),
);

it.live("the Promise client gets the declared not_found code back, and onCall reports it", () =>
  Effect.gen(function* readsMissing() {
    const calls: CallEntry[] = [];
    const { token } = yield* signedIn;
    const failure = yield* Effect.promise(() =>
      clientWith(calls, token)
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
