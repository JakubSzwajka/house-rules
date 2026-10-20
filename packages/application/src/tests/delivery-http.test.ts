import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { answer, webRequest, makeApp } from "./delivery-fixtures.ts";

const t = makeApp();
afterAll(() => t.dispose());

const http = (method: string, path: string, token?: string, body?: unknown) =>
  answer(
    t.api,
    webRequest(`https://app.example${path}`, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-request-id": "demo-1",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const idsOf = (body: unknown): ReadonlyArray<string> =>
  (body as { bookings: ReadonlyArray<{ id: string }> }).bookings.map((booking) => booking.id);

it.effect("GET /api/bookings/b-1 decodes the path param and echoes the request id", () =>
  Effect.gen(function* decodesPathParam() {
    const r = yield* http("GET", "/api/bookings/b-1", "tok-ada");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: "b-1", owner: "ada", guestName: "Ada", nights: 3 });
    expect(r.headers.get("x-request-id")).toBe("demo-1");
  }),
);

it.effect("GET with a query decodes a Union from strings, so 5 arrives as a number", () =>
  Effect.gen(function* decodesQueryUnion() {
    const r = yield* http("GET", "/api/bookings?by=nights&minNights=5", "tok-ada");
    expect(r.status).toBe(200);
    expect(idsOf(r.body)).toEqual(["b-2"]);
  }),
);

it.effect("POST /api/find_bookings decodes the same Union from a JSON body", () =>
  Effect.gen(function* decodesBodyUnion() {
    const r = yield* http("POST", "/api/find_bookings", "tok-ada", { by: "guest", guest: "Ada" });
    expect(r.status).toBe(200);
    expect(idsOf(r.body)).toEqual(["b-1"]);
  }),
);

it.effect("bad input is a 400 that names the field and never quotes the value", () =>
  Effect.gen(function* badInput() {
    const r = yield* http("GET", "/api/bookings?by=nights&minNights=five", "tok-ada");
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid", message: "minNights is not valid." },
    });
    expect(JSON.stringify(r.body)).not.toContain("five");
  }),
);

it.effect("an undeclared field is a 400", () =>
  Effect.gen(function* undeclaredField() {
    const r = yield* http("POST", "/api/find_bookings", "tok-ada", {
      by: "guest",
      guest: "Ada",
      admin: true,
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid", message: "admin is not a field here." },
    });
  }),
);

it.effect("a key given twice is a 400", () =>
  Effect.gen(function* duplicateKey() {
    const fromQuery = yield* http("GET", "/api/bookings?by=nights&by=guest", "tok-ada");
    expect(fromQuery.status).toBe(400);
    expect(fromQuery.body).toMatchObject({ error: { message: "Give by once." } });
    const pathAndQuery = yield* http("GET", "/api/bookings/b-1?id=b-2", "tok-ada");
    expect(pathAndQuery.status).toBe(400);
    const pathAndBody = yield* http("POST", "/api/bookings/b-1/cancel", "tok-ada", { id: "b-2" });
    expect(pathAndBody.status).toBe(400);
    expect(pathAndBody.body).toMatchObject({ error: { message: "Give id once." } });
  }),
);

it.effect("no token is a 401 with a WWW-Authenticate challenge", () =>
  Effect.gen(function* noToken() {
    const r = yield* http("GET", "/api/bookings/b-1");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/resource_metadata=/u);
    expect(r.body).toMatchObject({ error: { code: "token_missing" } });
    expect(r.headers.get("x-request-id")).toBe("demo-1");
  }),
);

it.effect("a read credential cannot enter the mutable way", () =>
  Effect.gen(function* forbiddenByScope() {
    const r = yield* http("POST", "/api/bookings/b-1/cancel", "tok-ada-read");
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { code: "forbidden" } });
  }),
);

it.effect("a node's not_found kind is a 404 with the way's message", () =>
  Effect.gen(function* notFound() {
    const r = yield* http("GET", "/api/bookings/b-3", "tok-ada");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "not_found", message: "Booking b-3 was not found." } });
  }),
);

it.effect("needsApproval over plain HTTP fails closed with kind forbidden", () =>
  Effect.gen(function* approvalFailsClosed() {
    const r = yield* http("POST", "/api/bookings/b-1/cancel", "tok-ada");
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { code: "forbidden" } });
    const still = yield* http("GET", "/api/bookings/b-1", "tok-ada");
    expect(still.status).toBe(200);
  }),
);

it.effect("a Next route file is the handler itself: export const GET = api", () =>
  Effect.gen(function* nextRoute() {
    const GET = (request: Request): Promise<Response> => t.api(request);
    const r = yield* answer(
      GET,
      webRequest("https://app.example/api/bookings/b-2", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "b-2", guestName: "Grace" });
  }),
);
