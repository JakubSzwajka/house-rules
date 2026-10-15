import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  type CallEntry,
  defineApi,
  endpoint,
  HttpFailure,
  mount,
  type PromiseClientOptions,
  toFetchHandler,
  toPromiseClient,
} from "../index.ts";
import {
  bearerCallerFor,
  findBookings,
  makeApp,
  showBooking,
  webRequest,
} from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking.contract, "GET /bookings/:id"),
    findBookings: endpoint(findBookings.contract, "GET /bookings"),
  },
);

const t = makeApp();
const handler = toFetchHandler(t.app, {
  caller: bearerCallerFor(t.work),
  routes: mount(api, { showBooking, findBookings }),
});
afterAll(() => handler.dispose().then(t.dispose));

const inProcess: typeof globalThis.fetch = (url, init) => handler(webRequest(String(url), init));

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

it.effect("onCall carries the answer's request id, on success and on failure", () =>
  Effect.gen(function* requestIds() {
    const entries: Array<CallEntry> = [];
    // The handler keeps a safe incoming id, so the answer echoes the one this fetch sends.
    const taggedWith = (id: string) =>
      clientWith({
        onCall: (entry) => entries.push(entry),
        fetch: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("x-request-id", id);
          return inProcess(url, { ...init, headers });
        },
      });
    yield* Effect.promise(() => taggedWith("req-ok.1").findBookings({ by: "guest", guest: "A" }));
    yield* failureOf(() => taggedWith("req-missing.2").showBooking({ id: "missing" }));
    const unsafe = clientWith({
      onCall: (entry) => entries.push(entry),
      fetch: () =>
        Promise.resolve(
          // Two @types/node versions load here, so tsc sees two Response types.
          Response.json(
            {},
            {
              status: 404,
              headers: { "x-request-id": "not a plain id" },
            },
          ) as unknown as Response,
        ),
    });
    yield* failureOf(() => unsafe.showBooking({ id: "b-1" }));
    expect(entries.map((entry) => [entry.status, entry.requestId])).toEqual([
      [200, "req-ok.1"],
      [404, "req-missing.2"],
      [404, undefined],
    ]);
  }),
);
