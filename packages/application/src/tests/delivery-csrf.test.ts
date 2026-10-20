import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { admit, endpoint } from "../index.ts";
import { answer, makeApp, renameGuest, webRequest } from "./delivery-fixtures.ts";

const t = makeApp();
const plainApp = makeApp({
  path: "/",
  who: "session",
  endpoints: [endpoint(renameGuest, "PATCH /plain/:id")],
});
const plain = plainApp.router;
afterAll(() => plainApp.dispose().then(t.dispose));

const write = (path: string, headers: Record<string, string>, method = "PATCH") =>
  answer(
    t.web,
    webRequest(`https://app.example${path}`, {
      method,
      headers: { cookie: "session=s-ada", "content-type": "application/json", ...headers },
      body: JSON.stringify({ guestName: "Ada Lovelace" }),
    }),
  );

it.effect("a cookie write from the app's own origin goes through", () =>
  Effect.gen(function* sameOrigin() {
    const r = yield* write("/web/bookings/b-1", { origin: "https://app.example" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: "b-1" });
  }),
);

it.effect("a cookie write from another origin is a 403, before the caller or a service runs", () =>
  Effect.gen(function* otherOrigin() {
    const before = { ...t.work };
    const r = yield* write("/web/bookings/b-1", { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { code: "cross_origin" } });
    expect(t.work).toEqual(before);
  }),
);

it.effect("without Origin the Referer decides", () =>
  Effect.gen(function* refererDecides() {
    const ok = yield* write("/web/bookings/b-1", { referer: "https://app.example/bookings/b-1" });
    expect(ok.status).toBe(200);
    const refused = yield* write("/web/bookings/b-1", { referer: "https://evil.example/x" });
    expect(refused.status).toBe(403);
  }),
);

it.effect("a cookie write with neither Origin nor Referer is refused", () =>
  Effect.gen(function* noSource() {
    const r = yield* write("/web/bookings/b-1", {});
    expect(r.status).toBe(403);
    const opaque = yield* write("/web/bookings/b-1", { origin: "null" });
    expect(opaque.status).toBe(403);
  }),
);

it.effect("a route that opts out with a written reason skips the check", () =>
  Effect.gen(function* optedOut() {
    const r = yield* answer(
      t.web,
      webRequest("https://app.example/web/hooks/rename", {
        method: "POST",
        headers: { cookie: "session=s-ada", origin: "https://evil.example" },
        body: JSON.stringify({ id: "b-1", guestName: "Ada" }),
      }),
    );
    expect(r.status).toBe(200);
  }),
);

it.effect("reads are not checked", () =>
  Effect.gen(function* readsPass() {
    const r = yield* answer(
      t.web,
      webRequest("https://app.example/web/bookings/b-1", {
        headers: { cookie: "session=s-ada", origin: "https://evil.example" },
      }),
    );
    expect(r.status).toBe(200);
  }),
);

it.effect("any write that carries a Cookie is checked, whatever the caller", () =>
  Effect.gen(function* cookieDecides() {
    const before = { ...t.work };
    const unmarked = yield* answer(
      plain,
      webRequest("https://app.example/plain/b-1", {
        method: "PATCH",
        headers: { cookie: "session=s-ada", origin: "https://evil.example" },
        body: JSON.stringify({ guestName: "Ada" }),
      }),
    );
    expect(unmarked.status).toBe(403);
    expect(unmarked.body).toMatchObject({ error: { code: "cross_origin" } });
    expect(t.work).toEqual(before);
    for (const cookie of ["session=s-ada", ""]) {
      const bearerAndCookie = yield* answer(
        t.api,
        webRequest("https://app.example/api/find_bookings", {
          method: "POST",
          headers: { authorization: "Bearer tok-ada", cookie, origin: "https://evil.example" },
          body: JSON.stringify({ by: "guest", guest: "Ada" }),
        }),
      );
      expect(bearerAndCookie.status).toBe(403);
    }
    expect(t.work).toEqual(before);
  }),
);

it.effect("an opaque Referer never passes", () =>
  Effect.gen(function* opaqueReferer() {
    const r = yield* write("/web/bookings/b-1", { referer: "data:text/plain,x" });
    expect(r.status).toBe(403);
  }),
);

it.effect("a configured origin must be a plain http(s) origin, and null never is", () =>
  Effect.gen(function* () {
    for (const origin of ["null", "https://app.example/path", "ftp://app.example", "*"]) {
      const invalid = makeApp({ origins: [origin] });
      const result = yield* Effect.promise(() =>
        admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "api" }),
      );
      expect(result).toMatchObject({ ok: false, error: { _tag: "GraphInvalid" } });
      yield* Effect.promise(invalid.dispose);
    }
  }),
);

it.effect("a write with no Cookie is not checked: no session rides along cross-site", () =>
  Effect.gen(function* bearerPasses() {
    const r = yield* answer(
      t.api,
      webRequest("https://app.example/api/find_bookings", {
        method: "POST",
        headers: { authorization: "Bearer tok-ada", origin: "https://other.example" },
        body: JSON.stringify({ by: "guest", guest: "Ada" }),
      }),
    );
    expect(r.status).toBe(200);
  }),
);

it("an opt-out needs a reason", () => {
  expect(() => endpoint(renameGuest, "POST /x", { csrf: { skip: true, reason: " " } })).toThrow(
    /needs a reason/u,
  );
});
