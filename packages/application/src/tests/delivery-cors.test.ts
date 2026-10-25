import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { admit, endpoint } from "../index.ts";
import {
  answer,
  cancelBooking,
  makeApp,
  renameGuest,
  showBooking,
  webRequest,
} from "./delivery-fixtures.ts";

const page = "https://web.example";
const t = makeApp();
const corsApp = makeApp({
  cors: { origins: [page, "http://localhost:5173"] },
  endpoints: [
    endpoint(showBooking, "GET /bookings/:id"),
    endpoint(renameGuest, "PATCH /bookings/:id"),
    endpoint(renameGuest, "POST /rename"),
  ],
});
const api = corsApp.router;
afterAll(() => corsApp.dispose().then(t.dispose));

const at = (path: string, init: RequestInit = {}) =>
  Effect.promise(() => api(webRequest(`https://api.example${path}`, init)));

const preflight = (path: string, origin?: string) =>
  at(path, {
    method: "OPTIONS",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization, content-type",
    },
  });

const varyOrigin = (headers: Headers) =>
  (headers.get("vary") ?? "").split(",").some((each) => each.trim().toLowerCase() === "origin");

it.effect("a preflight from a listed origin is a 204 naming the place's methods", () =>
  Effect.gen(function* listedPreflight() {
    const r = yield* preflight("/api/bookings/b-1", page);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(page);
    expect(r.headers.get("access-control-allow-methods")).toBe("GET, PATCH");
    expect(r.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type, x-request-id",
    );
    expect(r.headers.get("access-control-max-age")).toBe("600");
    expect(r.headers.has("access-control-allow-credentials")).toBe(false);
    expect(varyOrigin(r.headers)).toBe(true);
    expect(r.body).toBeNull();
    const one = yield* preflight("/api/rename", "http://localhost:5173");
    expect(one.headers.get("access-control-allow-methods")).toBe("POST");
  }),
);

it.effect("a preflight from an unlisted origin, or with none, is a 403 with no CORS headers", () =>
  Effect.gen(function* unlistedPreflight() {
    for (const origin of ["https://evil.example", "https://web.example.evil", "null", undefined]) {
      const r = yield* preflight("/api/bookings/b-1", origin);
      expect(r.status).toBe(403);
      expect(r.headers.has("access-control-allow-origin")).toBe(false);
      expect(r.headers.has("access-control-allow-methods")).toBe(false);
      expect(varyOrigin(r.headers)).toBe(true);
    }
  }),
);

it.effect("a place no route mounts gets no preflight answer", () =>
  Effect.gen(function* unmountedPreflight() {
    const r = yield* preflight("/api/elsewhere", page);
    expect(r.status).toBe(404);
    expect(r.headers.get("access-control-allow-origin")).toBe(page);
    expect(r.headers.has("access-control-allow-methods")).toBe(false);
  }),
);

it.effect("an answer to a listed origin carries ACAO, Vary and the exposed headers", () =>
  Effect.gen(function* listedAnswer() {
    const r = yield* answer(
      api,
      webRequest("https://api.example/api/bookings/b-1", {
        headers: { authorization: "Bearer tok-ada", origin: page },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(page);
    expect(r.headers.get("access-control-expose-headers")).toBe("x-failure-code, x-request-id");
    expect(r.headers.has("access-control-allow-credentials")).toBe(false);
    expect(varyOrigin(r.headers)).toBe(true);
    expect(r.headers.get("x-request-id")).not.toBeNull();
  }),
);

it.effect(
  "an unlisted origin gets the answer with no CORS headers, so its page cannot read it",
  () =>
    Effect.gen(function* unlistedAnswer() {
      const r = yield* answer(
        api,
        webRequest("https://api.example/api/bookings/b-1", {
          headers: { authorization: "Bearer tok-ada", origin: "https://evil.example" },
        }),
      );
      // CORS is not access control: the call runs; the bearer token and the gates guard it.
      expect(r.status).toBe(200);
      expect(r.headers.has("access-control-allow-origin")).toBe(false);
      expect(r.headers.has("access-control-expose-headers")).toBe(false);
      expect(varyOrigin(r.headers)).toBe(true);
    }),
);

it.effect("the router ignores case, which staticFiles' exclude check relies on", () =>
  Effect.gen(function* caseInsensitive() {
    const r = yield* answer(
      api,
      webRequest("https://api.example/API/Bookings/b-1", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "b-1" });
  }),
);

it.effect("error answers carry ACAO too, so the page can read the failure", () =>
  Effect.gen(function* errorAnswers() {
    const missing = yield* answer(
      api,
      webRequest("https://api.example/api/bookings/missing", {
        headers: { authorization: "Bearer tok-ada", origin: page },
      }),
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe(page);
    const anonymous = yield* answer(
      api,
      webRequest("https://api.example/api/bookings/b-1", { headers: { origin: page } }),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("access-control-allow-origin")).toBe(page);
    expect(anonymous.headers.get("www-authenticate")).toMatch(/^Bearer /u);
  }),
);

it.effect("a listed origin makes bearer writes; a cookie write still meets the CSRF check", () =>
  Effect.gen(function* csrfInterplay() {
    const write = (headers: Record<string, string>) =>
      answer(
        api,
        webRequest("https://api.example/api/bookings/b-1", {
          method: "PATCH",
          headers: { authorization: "Bearer tok-ada", origin: page, ...headers },
          body: JSON.stringify({ guestName: "Ada Lovelace" }),
        }),
      );
    const bearer = yield* write({});
    expect(bearer.status).toBe(200);
    expect(bearer.headers.get("access-control-allow-origin")).toBe(page);
    const before = { ...corsApp.work };
    const cookie = yield* write({ cookie: "session=s-ada" });
    expect(cookie.status).toBe(403);
    expect(cookie.body).toMatchObject({ error: { code: "cross_origin" } });
    expect(cookie.headers.get("access-control-allow-origin")).toBe(page);
    expect(corsApp.work).toEqual(before);
  }),
);

it.effect("without cors, a handler answers no preflight and sends no CORS headers", () =>
  Effect.gen(function* noCors() {
    const r = yield* Effect.promise(() =>
      t.api(
        webRequest("https://app.example/api/bookings/b-1", {
          method: "OPTIONS",
          headers: { origin: page, "access-control-request-method": "GET" },
        }),
      ),
    );
    expect(r.status).toBe(404);
    expect(r.headers.has("access-control-allow-origin")).toBe(false);
    expect(r.headers.has("vary")).toBe(false);
  }),
);

const shortApp = makeApp({
  path: "/",
  cors: { origins: [page], maxAge: 5 },
  endpoints: [endpoint(showBooking, "GET /bookings/:id")],
});
const short = shortApp.router;
afterAll(shortApp.dispose);

it.effect("maxAge sets the preflight cache", () =>
  Effect.gen(function* maxAge() {
    const r = yield* Effect.promise(() =>
      short(
        webRequest("https://api.example/bookings/b-1", {
          method: "OPTIONS",
          headers: { origin: page },
        }),
      ),
    );
    expect(r.headers.get("access-control-max-age")).toBe("5");
  }),
);

const mixedApp = makeApp({
  path: "/",
  cors: { origins: [page] },
  endpoints: [
    endpoint(showBooking, "GET /bookings/b-1"),
    endpoint(renameGuest, "PATCH /bookings/:id"),
    endpoint(cancelBooking, "DELETE /bookings/:id/guest"),
  ],
});
const mixed = mixedApp.router;
afterAll(mixedApp.dispose);

const mixedPreflight = (path: string) =>
  Effect.promise(() =>
    mixed(
      webRequest(`https://api.example${path}`, {
        method: "OPTIONS",
        headers: { origin: page, "access-control-request-method": "PATCH" },
      }),
    ),
  );

it.effect("a preflight names every method whose route matches the concrete path", () =>
  Effect.gen(function* concretePreflight() {
    const literal = yield* mixedPreflight("/bookings/b-1");
    expect(literal.status).toBe(204);
    expect(literal.headers.get("access-control-allow-methods")).toBe("GET, PATCH");
    const other = yield* mixedPreflight("/bookings/b-2");
    expect(other.headers.get("access-control-allow-methods")).toBe("PATCH");
    // The router ignores case and a trailing slash, so the preflight does too.
    const spelled = yield* mixedPreflight("/Bookings/B-1/");
    expect(spelled.headers.get("access-control-allow-methods")).toBe("GET, PATCH");
    const nested = yield* mixedPreflight("/bookings/b-1/guest");
    expect(nested.headers.get("access-control-allow-methods")).toBe("DELETE");
  }),
);

it.effect.each([
  [{ origins: [] }, /origins is empty/u],
  [{ origins: ["*"] }, /not an http\(s\) origin/u],
  [{ origins: ["null"] }, /not an http\(s\) origin/u],
  [{ origins: ["https://web.example/"] }, /not an http\(s\) origin/u],
  [{ origins: ["ftp://web.example"] }, /not an http\(s\) origin/u],
  [{ origins: [page], maxAge: -1 }, /maxAge/u],
  [{ origins: [page], maxAge: 1.5 }, /maxAge/u],
])("cors %j is refused at acquisition", ([cors, message]) =>
  Effect.gen(function* () {
    const invalid = makeApp({ cors: cors as import("../index.ts").CorsOptions });
    const result = yield* Effect.promise(() =>
      admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "api" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "GraphInvalid", reason: expect.stringMatching(message as RegExp) },
    });
    yield* Effect.promise(invalid.dispose);
  }),
);
