import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { call, Refused } from "../index.ts";
import { cancelBooking, findBookings, makeApp, showBooking } from "./delivery-fixtures.ts";

const t = makeApp({ who: "session" });
afterAll(() => t.dispose());

const signedIn = { headers: new Headers({ cookie: "session=s-ada" }), url: "/bookings" };

const bookingPage = (id: string, headers: Headers): Effect.Effect<string> =>
  Effect.promise(() =>
    call(t.app, showBooking, { id }, { headers, url: `/bookings/${id}` }, { way: "api" }),
  ).pipe(
    Effect.map((result) =>
      result.ok
        ? `<h1>${result.value.guestName}</h1><p>${result.value.nights} nights</p>`
        : `<p role="alert">${(result.view.body as { error: { message: string } }).error.message}</p>`,
    ),
  );

it.effect("a server component calls in-process with the session cookie", () =>
  Effect.gen(function* serverComponent() {
    expect(yield* bookingPage("b-1", signedIn.headers)).toBe("<h1>Ada</h1><p>3 nights</p>");
  }),
);

it.effect("a server component without a session renders the Refused view", () =>
  Effect.gen(function* noSession() {
    expect(yield* bookingPage("b-1", new Headers())).toBe('<p role="alert">Sign in again.</p>');
  }),
);

it.effect("call() returns the typed failure and its view", () =>
  Effect.gen(function* typedFailure() {
    const result = yield* Effect.promise(() =>
      call(t.app, showBooking, { id: "b-3" }, signedIn, { way: "api" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ _tag: "BookingNotFound", id: "b-3" });
    expect(result.view).toEqual({
      status: 404,
      code: "not_found",
      body: { error: { code: "not_found", message: "Booking b-3 was not found." } },
    });
  }),
);

it.effect("call() decodes its input, because a server action's input is untrusted", () =>
  Effect.gen(function* decodesInput() {
    const sneaky = {
      by: "nights",
      minNights: "5",
    } as unknown as typeof findBookings.node.input.Type;
    const result = yield* Effect.promise(() =>
      call(t.app, findBookings, sneaky, signedIn, { way: "api" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.view.status).toBe(400);
    expect(result.view.body).toMatchObject({ error: { message: "minNights is not valid." } });
  }),
);

it.effect("call() approves with allowAll, because a click in the app is the human's yes", () =>
  Effect.gen(function* approvesClicks() {
    const result = yield* Effect.promise(() =>
      call(t.app, cancelBooking, { id: "b-2" }, signedIn, { way: "api" }),
    );
    expect(result).toEqual({ ok: true, value: { cancelled: "b-2" } });
  }),
);

it.effect("call() refuses before any service work when the caller refuses", () =>
  Effect.gen(function* refusesFirst() {
    const before = t.work.calls;
    const result = yield* Effect.promise(() =>
      call(t.app, showBooking, { id: "b-1" }, { headers: new Headers(), url: "/" }, { way: "api" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(Refused);
    expect(t.work.calls).toBe(before);
  }),
);
