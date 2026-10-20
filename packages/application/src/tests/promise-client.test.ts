import { afterAll, expect, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  type CallEntry,
  defineApi,
  endpoint,
  HttpFailure,
  type PromiseClientOptions,
  type PromiseFailureOf,
  toFetchHandler,
  toPromiseClient,
} from "../index.ts";
import {
  crash,
  findBookings,
  makeApp,
  renameGuest,
  showBooking,
  webRequest,
} from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found"] }),
    findBookings: endpoint(findBookings, "GET /bookings"),
    renameGuest: endpoint(renameGuest, "PATCH /bookings/:id"),
    crash: endpoint(crash),
  },
);

const t = makeApp({ endpoints: Object.values(api.endpoints) });
const handler = toFetchHandler(t.app);
afterAll(() => handler.dispose().then(t.dispose));

const seen: Array<Headers> = [];

const inProcess: typeof globalThis.fetch = (url, init) => {
  const request = webRequest(String(url), init);
  seen.push(request.headers);
  return handler(request);
};

const clientWith = (options: PromiseClientOptions = {}) =>
  toPromiseClient(api, {
    baseUrl: "https://app.example",
    token: () => "tok-ada",
    fetch: inProcess,
    ...options,
  });

const failureOf = <A>(call: () => Promise<A>) =>
  Effect.promise(() =>
    call().then(
      () => undefined,
      (error: unknown) => error,
    ),
  ).pipe(
    Effect.flatMap((error) =>
      Schema.is(HttpFailure)(error) ? Effect.succeed(error) : Effect.die(error),
    ),
  );

it.effect("a call resolves the contract's decoded output", () =>
  Effect.gen(function* roundTrip() {
    const client = clientWith();
    const call: (input: { readonly id: string }) => Promise<{ readonly guestName: string }> =
      client.showBooking;
    // @ts-expect-error show_booking takes an id, not a guest.
    expect(() => client.showBooking({ guest: "Ada" }).catch(() => undefined)).not.toThrow();
    const booking = yield* Effect.promise(() => call({ id: "b-1" }));
    expect(booking).toEqual({ id: "b-1", owner: "ada", guestName: "Ada", nights: 3 });
    const found = yield* Effect.promise(() => client.findBookings({ by: "nights", minNights: 5 }));
    expect(found.bookings.map((each) => each.id)).toEqual(["b-2"]);
    const renamed = yield* Effect.promise(() =>
      client.renameGuest({ id: "b-1", guestName: "Ada Lovelace" }),
    );
    expect(renamed).toEqual({ id: "b-1" });
  }),
);

it.effect("a declared code exposed by the view rejects with that typed code", () =>
  Effect.gen(function* typedCode() {
    const client = clientWith();
    const failure = yield* failureOf(() => client.showBooking({ id: "missing" }));
    const codes: Array<PromiseFailureOf<typeof api.endpoints.showBooking>["code"]> = [
      "not_found",
      "Unknown",
      // @ts-expect-error show_booking declares no forbidden code.
      "forbidden",
    ];
    expect(codes).toContain(failure.code);
    expect(failure).toMatchObject({
      _tag: "HttpFailure",
      code: "not_found",
      status: 404,
      body: { error: { code: "not_found", message: "Booking missing was not found." } },
    });
  }),
);

it.effect("a code the endpoint does not declare, a 5xx, or no answer is Unknown", () =>
  Effect.gen(function* unknownCode() {
    const client = clientWith();
    const undeclared = yield* failureOf(() =>
      client.renameGuest({ id: "missing", guestName: "Nobody" }),
    );
    expect(undeclared).toMatchObject({ code: "Unknown", status: 404 });
    const defect = yield* failureOf(() => client.crash({}));
    expect(defect).toMatchObject({ code: "Unknown", status: 500 });
    const offline = clientWith({ fetch: () => Promise.reject(new TypeError("offline")) });
    const network = yield* failureOf(() => offline.showBooking({ id: "b-1" }));
    expect(network).toMatchObject({ code: "Unknown", status: 0 });
  }),
);

it.effect("the token goes out as Authorization: Bearer, and none goes out without one", () =>
  Effect.gen(function* token() {
    seen.length = 0;
    const asyncToken = clientWith({ token: () => Promise.resolve("tok-ada") });
    yield* Effect.promise(() => asyncToken.showBooking({ id: "b-1" }));
    expect(seen.at(-1)?.get("authorization")).toBe("Bearer tok-ada");
    const anonymous = clientWith({ token: () => undefined });
    const refused = yield* failureOf(() => anonymous.showBooking({ id: "b-1" }));
    expect(seen.at(-1)?.has("authorization")).toBe(false);
    expect(refused).toMatchObject({
      code: "Unknown",
      status: 401,
      body: { error: { code: "token_missing" } },
    });
  }),
);

it.effect("onCall reports every call, with its failure code", () =>
  Effect.gen(function* report() {
    const entries: Array<CallEntry> = [];
    const client = clientWith({ onCall: (entry) => entries.push(entry) });
    yield* Effect.promise(() => client.showBooking({ id: "b 1" }).catch(() => undefined));
    yield* Effect.promise(() => client.findBookings({ by: "guest", guest: "Ada" }));
    yield* failureOf(() => client.showBooking({ id: "missing" }));
    yield* failureOf(() => client.crash({}));
    expect(entries.map(({ ms: _ms, requestId: _id, ...entry }) => entry)).toEqual([
      {
        name: "show_booking",
        method: "GET",
        path: "/api/bookings/b%201",
        status: 404,
        code: "not_found",
      },
      {
        name: "find_bookings",
        method: "GET",
        path: "/api/bookings?by=guest&guest=Ada",
        status: 200,
      },
      {
        name: "show_booking",
        method: "GET",
        path: "/api/bookings/missing",
        status: 404,
        code: "not_found",
      },
      { name: "crash", method: "POST", path: "/api/crash", status: 500, code: "Unknown" },
    ]);
    expect(entries.every((entry) => Number.isInteger(entry.ms) && entry.ms >= 0)).toBe(true);
  }),
);

it.effect("a client with no baseUrl sends to the page's own origin, never another", () =>
  Effect.gen(function* sameOrigin() {
    vi.stubGlobal("location", { origin: "https://app.example", pathname: "/" });
    const sent: Array<URL> = [];
    const spy: typeof globalThis.fetch = (url, init) => {
      sent.push(new URL(String(url)));
      return inProcess(url, init);
    };
    const { baseUrl: _unused, ...rest } = { baseUrl: "", fetch: spy };
    const client = toPromiseClient(api, { ...rest, token: () => "tok-ada" });
    yield* Effect.promise(() => client.showBooking({ id: "b-1" }));
    const rooted = toPromiseClient(defineApi({}, { showBooking: api.endpoints.showBooking }), rest);
    yield* Effect.promise(() => rooted.showBooking({ id: "b-1" }).catch(() => undefined));
    expect(sent.map((url) => url.origin)).toEqual(["https://app.example", "https://app.example"]);
    expect(sent[0]?.pathname).toBe("/api/bookings/b-1");
    expect(sent[1]?.pathname).toBe("/bookings/b-1");
    for (const prefix of [
      "//collector.example",
      "/\\collector.example",
      "https://collector.example",
    ]) {
      expect(() => defineApi({ prefix: prefix as `/${string}` }, {})).toThrow(/plain path/u);
    }
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);

it.effect("a path value stays one encoded segment on the base origin", () =>
  Effect.gen(function* encoded() {
    const sent: Array<string> = [];
    const spy: typeof globalThis.fetch = (url, init) => {
      sent.push(String(url));
      return inProcess(url, init);
    };
    const client = clientWith({ fetch: spy });
    const ids = [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "%2F%2Fhost",
      "caf\u00e9/\u2215x",
      "a\tb\n",
      "x?y#z",
    ];
    for (const id of ids) {
      yield* Effect.promise(() => client.showBooking({ id }).catch(() => undefined));
    }
    // A dot segment folds into the path above, and an empty one joins two slashes, so the call never goes out.
    for (const id of ["", ".", ".."]) {
      const failure = yield* failureOf(() => client.showBooking({ id }));
      expect(failure, id).toMatchObject({ code: "Unknown", status: 0 });
    }
    expect(sent).toHaveLength(ids.length);
    for (const [at, href] of sent.entries()) {
      const url = new URL(href);
      expect(url.origin, href).toBe("https://app.example");
      expect(url.pathname, href).toBe(`/api/bookings/${encodeURIComponent(ids[at] ?? "")}`);
    }
  }),
);

it.effect("a request that would leave the base origin is refused before it is sent", () =>
  Effect.gen(function* refusal() {
    // No baseUrl: the path is the whole URL, so the page's origin is the one to hold.
    vi.stubGlobal("location", { origin: "https://app.example", pathname: "/" });
    const sent: Array<string> = [];
    const spy: typeof globalThis.fetch = (url) => {
      sent.push(String(url));
      return Promise.reject(new Error("must not be sent"));
    };
    // Built by hand, past defineApi: the client must hold even when the API list was not checked.
    const rogue = (path: string) =>
      toPromiseClient(
        {
          _tag: "Api",
          prefix: "",
          endpoints: { one: { ...api.endpoints.findBookings, path: path as `/${string}` } },
        } as never as typeof api,
        { token: () => "tok-ada", fetch: spy },
      );
    const paths = [
      "/\t/collector.example/x",
      "/\n/collector.example/x",
      "/\r/collector.example/x",
      "//collector.example/x",
      "/\\collector.example/x",
    ];
    for (const path of paths) {
      const failure = yield* failureOf(() =>
        (rogue(path) as unknown as { one: (input: unknown) => Promise<unknown> }).one({
          by: "nights",
          minNights: 1,
        }),
      );
      expect(failure, path).toMatchObject({ code: "Unknown", status: 0 });
    }
    expect(sent).toEqual([]);
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);
