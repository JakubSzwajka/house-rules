import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { handler, openApi } from "../main.js";
import { app } from "../composition/index.js";

afterAll(() => handler.dispose().then(app.dispose));

const send = (path: string, init: RequestInit = {}) =>
  Effect.promise(() =>
    handler(new Request(`https://booking.example${path}`, init) as Request),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, headers: response.headers, body })),
      ),
    ),
  );

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  send(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://booking.example", ...headers },
    body: JSON.stringify(body),
  });

const credentials = { email: "main@example.test", password: "a long enough secret" };
const token = Effect.gen(function* signedIn() {
  yield* post("/api/sign-up", { ...credentials, displayName: "Main" });
  const signedInAnswer = yield* post("/api/token", credentials);
  return (signedInAnswer.body as { token: string }).token;
});

const get = (path: string, headers: Record<string, string> = {}) =>
  Effect.gen(function* authorized() {
    return yield* send(path, { headers: { authorization: `Bearer ${yield* token}`, ...headers } });
  });

it.effect("sign-up and sign-in answer on /api without a token; the rest needs one", () =>
  Effect.gen(function* publicRoutes() {
    expect((yield* token).length).toBeGreaterThan(0);
    const anonymous = yield* send("/api/bookings/demo");
    expect(anonymous).toMatchObject({ status: 401, body: { error: { code: "token_missing" } } });
    const wrong = yield* post("/api/sign-in", { ...credentials, password: "wrong password" });
    expect(wrong).toMatchObject({ status: 401, body: { error: { code: "invalid_credentials" } } });
  }),
);

it.effect("GET /api/bookings/:id maps BookingNotFound through the app's view", () =>
  Effect.gen(function* notFound() {
    const r = yield* get("/api/bookings/missing", { "x-request-id": "req-1" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({
      error: { code: "not_found", message: "Booking missing was not found." },
    });
    expect(r.headers.get("x-request-id")).toBe("req-1");
  }),
);

it.effect("memory mode serves the seeded demo booking", () =>
  Effect.gen(function* demo() {
    const r = yield* get("/api/bookings/demo");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: "demo", guestName: "Ada Lovelace", status: "active" });
  }),
);

it.effect("an unknown query key is a 400 that names it", () =>
  Effect.gen(function* unknownKey() {
    const r = yield* get("/api/bookings/b-1?admin=true");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: "invalid_input", field: "admin" } });
  }),
);

it.effect("with no built page and no WEB_ROOT, the handler serves the API only", () =>
  Effect.gen(function* apiOnly() {
    const response = yield* Effect.promise(() =>
      handler(new Request("https://booking.example/", { headers: { accept: "text/html" } })),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  }),
);

it("the OpenAPI document lists the route with the statuses its views fix", () => {
  const get = (openApi.paths["/api/bookings/{id}"] ?? {}).get ?? {};
  expect(get.operationId).toBe("show_booking");
  expect(Object.keys(get.responses ?? {}).sort()).toEqual([
    "200",
    "400",
    "403",
    "404",
    "503",
    "default",
  ]);
});
