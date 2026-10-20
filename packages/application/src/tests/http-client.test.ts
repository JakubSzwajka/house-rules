import { defineNode } from "@house-rules/domain";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { FetchHttpClient, type HttpClientError } from "effect/http";
import {
  defineEntry,
  endpoint,
  failureCodeHeader,
  HttpFailure,
  toFetchHandler,
  toHttpClient,
} from "../index.ts";
import {
  Booking,
  BookingNotFound,
  crash,
  findBookings,
  makeApp,
  renameGuest,
  showBooking,
  webRequest,
} from "./delivery-fixtures.ts";

const at = {
  show: endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found"] }),
  find: endpoint(findBookings, "GET /bookings"),
  rename: endpoint(renameGuest, "PATCH /bookings/:id", { codes: ["not_found"] }),
  crash: endpoint(crash),
} as const;

const t = makeApp({
  who: "session",
  endpoints: Object.values(at),
  origins: ["https://app.example"],
});
const api = toFetchHandler(t.app);
afterAll(() => api.dispose().then(t.dispose));

const client = toHttpClient([at.show, at.find, at.rename, at.crash], {
  prefix: "/api",
  baseUrl: "https://app.example",
});

type Browser = Readonly<{ cookie?: string; origin?: string }>;

const asBrowser =
  (browser: Browser = { cookie: "session=s-ada", origin: "https://app.example" }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, (input, init) => {
        const request = webRequest(String(input), init);
        const headers = new Headers(request.headers);
        if (browser.cookie !== undefined) headers.set("cookie", browser.cookie);
        if (browser.origin !== undefined && request.method !== "GET") {
          headers.set("origin", browser.origin);
        }
        const body = init?.body ?? null;
        return api(webRequest(request.url, { method: request.method, headers, body }));
      }),
    );

const failureOf = <A, E extends HttpFailure | HttpClientError.HttpClientError, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.flip(effect).pipe(
    Effect.flatMap((error) =>
      Schema.is(HttpFailure)(error) ? Effect.succeed(error) : Effect.die(error),
    ),
  );

it.effect("a GET decodes the contract's output", () =>
  Effect.gen(function* readsOne() {
    const booking = yield* client.show_booking({ id: "b-1" }).pipe(asBrowser());
    expect(booking).toEqual({ id: "b-1", owner: "ada", guestName: "Ada", nights: 3 });
  }),
);

it.effect("a GET with a Union input sends its fields as the query string", () =>
  Effect.gen(function* readsUnion() {
    const found = yield* client.find_bookings({ by: "nights", minNights: 5 }).pipe(asBrowser());
    expect(found.bookings.map((booking) => booking.id)).toEqual(["b-2"]);
  }),
);

it.effect("a path value is escaped on the way and read back whole", () =>
  Effect.gen(function* escapesPath() {
    const failure = yield* failureOf(client.show_booking({ id: "a b/c?" }).pipe(asBrowser()));
    expect(failure.body).toEqual({
      error: { code: "not_found", message: "Booking a b/c? was not found." },
    });
  }),
);

it.effect("a write sends JSON and passes the CSRF check from the app's own origin", () =>
  Effect.gen(function* writes() {
    const renamed = yield* client
      .rename_guest({ id: "b-1", guestName: "Ada Lovelace" })
      .pipe(asBrowser());
    expect(renamed).toEqual({ id: "b-1" });
  }),
);

it.effect("a failure whose view exposes a declared code comes back with that code", () =>
  Effect.gen(function* typedFailure() {
    const failure = yield* failureOf(client.show_booking({ id: "missing" }).pipe(asBrowser()));
    expect(failure).toMatchObject({
      _tag: "HttpFailure",
      code: "not_found",
      status: 404,
      body: { error: { code: "not_found", message: "Booking missing was not found." } },
    });
  }),
);

it.effect("a refusal from the caller is Unknown, with its status and body", () =>
  Effect.gen(function* refused() {
    const failure = yield* failureOf(
      client.show_booking({ id: "b-1" }).pipe(asBrowser({ origin: "https://app.example" })),
    );
    expect(failure).toMatchObject({
      code: "Unknown",
      status: 401,
      body: { error: { code: "session_invalid" } },
    });
  }),
);

it.effect("a cookie write from another origin is a 403 with the cross_origin body", () =>
  Effect.gen(function* crossSite() {
    const before = { ...t.work };
    const failure = yield* failureOf(
      client
        .rename_guest({ id: "b-1", guestName: "Mallory" })
        .pipe(asBrowser({ cookie: "session=s-ada", origin: "https://evil.example" })),
    );
    expect(failure).toMatchObject({
      code: "Unknown",
      status: 403,
      body: { error: { code: "cross_origin" } },
    });
    expect(t.work).toEqual(before);
  }),
);

it.effect("a stale client whose input drifted gets a 400 invalid_input", () =>
  Effect.gen(function* staleClient() {
    const stale = defineEntry(
      defineNode("show_booking", {
        description: "An older show_booking that also sent a field the server dropped.",
        input: Schema.Struct({ id: Schema.String, expand: Schema.String }),
        output: Booking,
        failure: BookingNotFound,
        permission: "bookings:read",
      }),
    );
    const old = toHttpClient([endpoint(stale, "GET /bookings/:id")], {
      prefix: "/api",
      baseUrl: "https://app.example",
    });
    const failure = yield* failureOf(
      old.show_booking({ id: "b-1", expand: "guest" }).pipe(asBrowser()),
    );
    expect(failure).toMatchObject({
      code: "Unknown",
      status: 400,
      body: { error: { code: "invalid", message: "expand is not a field here." } },
    });
  }),
);

it.effect("a defect is a 500 with no code, so the client calls it Unknown", () =>
  Effect.gen(function* defect() {
    const failure = yield* failureOf(client.crash({}).pipe(asBrowser()));
    expect(failure).toMatchObject({ code: "Unknown", status: 500 });
  }),
);

it.effect("the fetch handler sends a code only when the view exposes it", () =>
  Effect.gen(function* tagHeader() {
    const missing = yield* Effect.promise(() =>
      api(
        webRequest("https://app.example/api/bookings/missing", {
          headers: { cookie: "session=s-ada" },
        }),
      ),
    );
    expect(missing.headers.get(failureCodeHeader)).toBe("not_found");
    const crashed = yield* Effect.promise(() =>
      api(
        webRequest("https://app.example/api/crash", {
          method: "POST",
          headers: { cookie: "session=s-ada", origin: "https://app.example" },
        }),
      ),
    );
    expect(crashed.status).toBe(500);
    expect(crashed.headers.get(failureCodeHeader)).toBeNull();
  }),
);

it("an endpoint must name the capability the route mounts", () => {
  expect(at.rename.entry).toBe(renameGuest);
  expect(at.rename.entry).not.toBe(showBooking);
  expect(() => toHttpClient([at.show, at.show])).toThrow(/listed twice/u);
  expect(() => endpoint(showBooking, "GET /x", { codes: ["NotFound"] })).toThrow(
    /"NotFound" is not snake_case/u,
  );
  expect(() => endpoint(showBooking, "GET /files/*")).not.toThrow();
  expect(() => toHttpClient([endpoint(showBooking, "GET /files/*")])).toThrow(
    /is not a plain :name/u,
  );
});
