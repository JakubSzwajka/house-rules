import { api, signIn, signOut, leaky } from "./session-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { endpoint, admit, toFetchHandler, toOpenApi, toPromiseClient } from "../index.ts";
import { answer, makeApp, renameGuest, webRequest } from "./delivery-fixtures.ts";

const t = makeApp();
const entries = [signIn, signOut, leaky] as const;
const routes = [
  ...Object.values(api.endpoints),
  endpoint(leaky, "POST /leaky", { session: "issue" }),
  endpoint(signIn, "POST /token"),
];
const plainApp = httpFixture(entries, {
  path: "/auth",
  session: { cookie: "sid" },
  endpoints: routes,
});
const proxiedApp = httpFixture(entries, {
  path: "/auth",
  session: { cookie: "sid" },
  origins: ["https://app.example"],
  endpoints: routes,
});
const prefixedApp = httpFixture(entries, {
  path: "/auth",
  session: { cookie: "__Host-sid" },
  endpoints: routes,
});
const writesApp = makeApp({
  path: "/",
  who: "session",
  endpoints: [endpoint(renameGuest, "PATCH /bookings/:id")],
});
const plain = plainApp.handler;
const proxied = proxiedApp.handler;
const prefixed = prefixedApp.handler;
const writes = writesApp.router;
afterAll(() =>
  Promise.all([
    plainApp.dispose(),
    proxiedApp.dispose(),
    prefixedApp.dispose(),
    writesApp.dispose(),
    t.dispose(),
  ]),
);

const maxAgeWithin10s = (cookie: string | null): string => {
  const seconds = Number(/Max-Age=(\d+)/u.exec(cookie ?? "")?.[1]);
  expect(seconds).toBeGreaterThanOrEqual(3590);
  expect(seconds).toBeLessThanOrEqual(3600);
  return (cookie ?? "").replace(/Max-Age=\d+/u, "Max-Age=3600");
};

const post = (
  handler: (request: Request) => Promise<Response>,
  url: string,
  headers: Record<string, string> = { origin: new URL(url).origin },
  body: unknown = { name: "ada" },
) =>
  answer(
    handler,
    webRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("session cookie issue, clear and CSRF", () => {
  it.effect("over http sets an HttpOnly, Lax cookie without Secure, and no token in the body", () =>
    Effect.gen(function* overHttp() {
      const r = yield* post(plain, "http://localhost:3000/auth/sign-in");
      expect(r.status).toBe(200);
      expect(maxAgeWithin10s(r.headers.get("set-cookie"))).toBe(
        "sid=tok.ada; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
      );
      expect(r.body).toEqual({ expiresAt: expect.any(Number), name: "ada" });
      expect(JSON.stringify(r.body)).not.toContain("tok.ada");
    }),
  );

  it.effect("over https, or behind a TLS proxy with an https Origin, the cookie is Secure", () =>
    Effect.gen(function* overHttps() {
      const direct = yield* post(plain, "https://app.example/auth/sign-in");
      expect(maxAgeWithin10s(direct.headers.get("set-cookie"))).toBe(
        "sid=tok.ada; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure",
      );
      const behindProxy = yield* post(proxied, "http://10.0.0.5:3000/auth/sign-in", {
        origin: "https://app.example",
      });
      expect(behindProxy.status).toBe(200);
      expect(maxAgeWithin10s(behindProxy.headers.get("set-cookie"))).toMatch(/; Secure$/u);
    }),
  );

  it.effect("a __Host- name is always Secure, with Path=/ and no Domain", () =>
    Effect.gen(function* hostPrefix() {
      const r = yield* post(prefixed, "http://localhost:3000/auth/sign-in");
      expect(maxAgeWithin10s(r.headers.get("set-cookie"))).toBe(
        "__Host-sid=tok.ada; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure",
      );
    }),
  );

  it.effect("the same capability on a route without the option answers the token, no cookie", () =>
    Effect.gen(function* bearerRoute() {
      const r = yield* post(plain, "http://localhost:3000/auth/token", {}); // no Origin, as a CLI sends it
      expect(r.status).toBe(200);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(r.body).toMatchObject({ token: "tok.ada", name: "ada" });
    }),
  );

  it.effect("a token that is not cookie-safe is a 500 and never reaches the log", () =>
    Effect.gen(function* notCookieSafe() {
      const r = yield* post(plain, "http://localhost:3000/auth/leaky", undefined, {});
      expect(r.status).toBe(500);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(JSON.stringify(t.logs)).not.toContain("secret-123");
    }),
  );

  it.effect("sends the same cookie with an empty value and Max-Age=0", () =>
    Effect.gen(function* clear() {
      const r = yield* post(
        plain,
        "https://app.example/auth/sign-out",
        { origin: "https://app.example", cookie: "sid=tok.ada" },
        {},
      );
      expect(r.status).toBe(200);
      expect(r.headers.get("set-cookie")).toBe(
        "sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
      );
    }),
  );

  it.effect("another site cannot sign a visitor in or out, cookie or not", () =>
    Effect.gen(function* loginCsrf() {
      const evil = { origin: "https://evil.example" };
      const signInFromEvil = yield* post(plain, "https://app.example/auth/sign-in", evil);
      expect(signInFromEvil.status).toBe(403);
      expect(signInFromEvil.body).toMatchObject({ error: { code: "cross_origin" } });
      expect(signInFromEvil.headers.get("set-cookie")).toBeNull();
      const noSource = yield* post(plain, "https://app.example/auth/sign-in", {});
      expect(noSource.status).toBe(403);
      const signOutFromEvil = yield* post(
        plain,
        "https://app.example/auth/sign-out",
        { ...evil, cookie: "sid=tok.ada" },
        {},
      );
      expect(signOutFromEvil.status).toBe(403);
      expect(signOutFromEvil.headers.get("set-cookie")).toBeNull();
    }),
  );

  it.effect(
    "a cookie-authenticated write from another origin is 403; a route without the option sets no cookie",
    () =>
      Effect.gen(function* cookieWrite() {
        const write = (origin: string) =>
          answer(
            writes,
            webRequest("https://app.example/bookings/b-1", {
              method: "PATCH",
              headers: { cookie: "session=s-ada", origin, "content-type": "application/json" },
              body: JSON.stringify({ guestName: "Ada Lovelace" }),
            }),
          );
        const refused = yield* write("https://evil.example");
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ error: { code: "cross_origin" } });
        const ok = yield* write("https://app.example");
        expect(ok.status).toBe(200);
        expect(ok.headers.get("set-cookie")).toBeNull();
      }),
  );
});

describe("mount-time checks", () => {
  it.effect("a session endpoint needs the way's session option at acquisition", () =>
    Effect.gen(function* () {
      const invalid = httpFixture(entries, { path: "/auth", endpoints: routes });
      const result = yield* Effect.promise(() =>
        admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "web" }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "GraphInvalid", reason: expect.stringMatching(/sets a session cookie/u) },
      });
      yield* Effect.promise(invalid.dispose);
    }),
  );

  it.effect("refuses a cookie name a browser would not accept", () =>
    Effect.gen(function* () {
      for (const cookie of ["", "s id", "sid;", "a=b"]) {
        const invalid = httpFixture(entries, {
          path: "/auth",
          endpoints: routes,
          session: { cookie },
        });
        const result = yield* Effect.promise(() =>
          admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "web" }),
        );
        expect(result).toMatchObject({
          ok: false,
          error: { _tag: "GraphInvalid", reason: expect.stringMatching(/is not a cookie name/u) },
        });
        yield* Effect.promise(invalid.dispose);
      }
    }),
  );

  it("refuses a GET session route, a CSRF opt-out, a second session source and an output without a token", () => {
    expect(() => endpoint(signOut, "GET /sign-out", { session: "clear" })).toThrow(
      /cannot be a GET/u,
    );
    expect(() =>
      endpoint(signIn, "POST /sign-in", {
        session: "issue",
        csrf: { skip: true, reason: "A test." },
      }),
    ).toThrow(/cannot set a session/u);
    const secondSource = () => {
      // @ts-expect-error The router takes session settings only from its ways.
      return toFetchHandler(plainApp.app, { session: { cookie: "other" } });
    };
    expect(typeof secondSource).toBe("function");
    // @ts-expect-error: a session issue route needs a token and expiresAt in its output
    expect(() => endpoint(signOut, "POST /sign-out", { session: "issue" })).toThrow(
      /needs a Struct output with token and expiresAt/u,
    );
  });
});

describe("clients and docs see the body without the token", () => {
  it.effect("the promise client resolves the reduced body", () =>
    Effect.gen(function* client() {
      const promises = toPromiseClient(api, {
        baseUrl: "https://app.example",
        fetch: (url, init) =>
          plain(
            webRequest(String(url), {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init?.headers)),
                origin: "https://app.example",
              },
            }),
          ),
      });
      const body = yield* Effect.promise(() => promises.signIn({ name: "ada" }));
      expect(body).toEqual({ expiresAt: expect.any(Number), name: "ada" });
      // @ts-expect-error: the client type has no token on a session issue endpoint
      expect(body.token).toBeUndefined();
    }),
  );

  it("OpenAPI describes the reduced body", () => {
    const document = toOpenApi(Object.values(api.endpoints), {
      title: "x",
      version: "1",
      prefix: "/auth",
    });
    const success = JSON.stringify(document.paths["/auth/sign-in"]);
    expect(success).toContain("expiresAt");
    expect(success).not.toContain('"token"');
  });
});
