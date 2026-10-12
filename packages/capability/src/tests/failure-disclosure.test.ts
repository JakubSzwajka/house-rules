import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  endpoint,
  failureCodeHeader,
  type Forbidden,
  HttpFailure,
  problem,
  problemView,
  route,
  toFetchHandler,
  toHttpClient,
} from "../index.ts";
import {
  answer,
  bearerCallerFor,
  type BookingNotFound,
  makeApp,
  renameGuest,
  webRequest,
} from "./delivery-fixtures.ts";

const t = makeApp();
afterAll(() => t.dispose());

const answerOf = (handler: (request: Request) => Promise<Response>, token: string, id: string) =>
  answer(
    handler,
    webRequest(`https://app.example/bookings/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ guestName: "Mallory" }),
    }),
  ).pipe(
    Effect.map(({ status, headers, body }) => ({
      status,
      headers: Object.fromEntries([...headers].filter(([name]) => name !== "x-request-id")),
      body,
    })),
  );

it.effect(
  "a view that hides Forbidden as a 404 sends nothing that tells it from a missing record",
  () =>
    Effect.gen(function* concealed() {
      const notFound = (_error: unknown) => "Not found.";
      const api = toFetchHandler(t.app, {
        caller: bearerCallerFor(t.work),
        views: {
          Forbidden: problemView(404, "not_found", (error: Forbidden) => notFound(error)),
          BookingNotFound: problemView(404, "not_found", (error: BookingNotFound) =>
            notFound(error),
          ),
        },
        routes: [route(renameGuest, "PATCH /bookings/:id")],
      });
      const forbidden = yield* answerOf(api, "tok-ada-read", "b-1");
      const missing = yield* answerOf(api, "tok-ada", "missing");
      yield* Effect.promise(() => api.dispose());
      expect(forbidden.status).toBe(404);
      expect(forbidden).toEqual(missing);
      expect(Object.keys(forbidden.headers).filter((name) => name.startsWith("x-failure"))).toEqual(
        [],
      );
    }),
);

const renameAt = endpoint(renameGuest.contract, "PATCH /bookings/:id", {
  codes: ["booking_not_found"],
});

it.effect("a view opts in to a public code, and only a code the endpoint declares goes out", () =>
  Effect.gen(function* optIn() {
    const api = toFetchHandler(t.app, {
      caller: bearerCallerFor(t.work),
      views: {
        Forbidden: problemView(403, "forbidden", (_error: Forbidden) => "No.", {
          exposeCode: true,
        }),
        BookingNotFound: problemView(
          404,
          "booking_not_found",
          (_error: BookingNotFound) => "Not found.",
          { exposeCode: true },
        ),
      },
      routes: [route(renameGuest, renameAt)],
    });
    const missing = yield* answerOf(api, "tok-ada", "missing");
    const forbidden = yield* answerOf(api, "tok-ada-read", "b-1");
    yield* Effect.promise(() => api.dispose());
    expect(missing.headers[failureCodeHeader]).toBe("booking_not_found");
    // The view exposes "forbidden", but the endpoint does not declare it, so it stays home.
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers[failureCodeHeader]).toBeUndefined();
  }),
);

const secretAt = endpoint(renameGuest.contract, "PATCH /bookings/:id", {
  codes: ["secret_reason"],
});

const secretView = (status: number) => ({
  BookingNotFound: problemView(status, "secret_reason", (_error: BookingNotFound) => "Not found.", {
    exposeCode: true,
  }),
});

const missingAnswer = (status: number, requestId: string) =>
  Effect.gen(function* missingWith() {
    const api = toFetchHandler(t.app, {
      caller: bearerCallerFor(t.work),
      views: secretView(status),
      routes: [route(renameGuest, secretAt)],
    });
    const r = yield* answer(
      api,
      webRequest("https://app.example/bookings/missing", {
        method: "PATCH",
        headers: {
          authorization: "Bearer tok-ada",
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ guestName: "Mallory" }),
      }),
    );
    yield* Effect.promise(() => api.dispose());
    return r;
  });

it.effect("a view that answers 500 sends the generic internal_error and logs its own body", () =>
  Effect.gen(function* reserved500() {
    const r = yield* missingAnswer(500, "view-500");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong on the server." },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/secret_reason/u);
    expect(r.headers.get(failureCodeHeader)).toBeNull();
    expect(r.headers.get("x-request-id")).toBe("view-500");
    expect(t.logs).toContainEqual({
      message: expect.arrayContaining([
        expect.stringContaining("A view answered 500"),
        expect.objectContaining({
          body: { error: { code: "secret_reason", message: "Not found." } },
        }),
      ]),
      annotations: expect.objectContaining({ requestId: "view-500" }),
    });
  }),
);

it.effect("a view's other 5xx keeps the body its author wrote", () =>
  Effect.gen(function* other5xx() {
    const r = yield* missingAnswer(503, "view-503");
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: { code: "secret_reason", message: "Not found." } });
    expect(r.headers.get(failureCodeHeader)).toBeNull();
  }),
);

it("the types refuse a literal 500 in a view", () => {
  // @ts-expect-error status 500 is reserved for defects
  expect(() => problemView(500, "x", () => "x")).not.toThrow();
  // @ts-expect-error status 500 is reserved for defects
  expect(problem(500, "x", "x").status).toBe(500);
  // @ts-expect-error a union that holds 500 is refused too
  expect(problem(500 as 404 | 500, "x", "x").status).toBe(500);
  expect(problem(503, "unavailable", "x").status).toBe(503);
});

const reply = (status: number, headers: Record<string, string>): Response =>
  // This workspace loads two @types/node versions, so the Response constructor and type differ.
  new Response("{}", { status, headers }) as Response;

const clientAnswering = (response: () => Response) =>
  Effect.flip(
    toHttpClient([renameAt], { baseUrl: "https://app.example" }).rename_guest({
      id: "b-1",
      guestName: "Ada",
    }),
  ).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, () => Promise.resolve(response())),
  );

it.effect("the client keeps a declared code, and calls a foreign code or a 5xx Unknown", () =>
  Effect.gen(function* normalised() {
    const declared = yield* clientAnswering(() =>
      reply(404, { [failureCodeHeader]: "booking_not_found" }),
    );
    expect(Schema.is(HttpFailure)(declared)).toBe(true);
    expect(declared).toMatchObject({ code: "booking_not_found", status: 404 });
    const foreign = yield* clientAnswering(() => reply(404, { [failureCodeHeader]: "ForeignTag" }));
    expect(foreign).toMatchObject({ code: "Unknown", status: 404 });
    const crashed = yield* clientAnswering(() =>
      reply(500, { [failureCodeHeader]: "booking_not_found" }),
    );
    expect(crashed).toMatchObject({ code: "Unknown", status: 500 });
    const legacy = yield* clientAnswering(() => reply(403, { "x-failure-tag": "Forbidden" }));
    expect(legacy).toMatchObject({ code: "Unknown", status: 403 });
  }),
);
