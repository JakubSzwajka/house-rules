import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  type CallReport,
  defineApi,
  endpoint,
  HttpFailure,
  type PromiseClientOptions,
  toFetchHandler,
  toPromiseClient,
} from "../index.ts";
import { findBookings, makeApp, showBooking, webRequest } from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking, "GET /bookings/:id"),
    findBookings: endpoint(findBookings, "GET /bookings"),
  },
);

const t = makeApp({ endpoints: Object.values(api.endpoints) });
const handler = toFetchHandler(t.app);
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
    const features: Array<CallReport> = [];
    // The handler keeps a safe incoming id, so the answer echoes the one this fetch sends.
    const taggedWith = (id: string) =>
      clientWith({
        onCall: (feature) => features.push(feature),
        fetch: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("x-request-id", id);
          return inProcess(url, { ...init, headers });
        },
      });
    yield* Effect.promise(() => taggedWith("req-ok.1").findBookings({ by: "guest", guest: "A" }));
    yield* failureOf(() => taggedWith("req-missing.2").showBooking({ id: "missing" }));
    const unsafe = clientWith({
      onCall: (feature) => features.push(feature),
      fetch: () =>
        Promise.resolve(
          // Two @types/callable versions load here, so tsc sees two Response types.
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
    expect(features.map((feature) => [feature.status, feature.requestId])).toEqual([
      [200, "req-ok.1"],
      [404, "req-missing.2"],
      [404, undefined],
    ]);
  }),
);
