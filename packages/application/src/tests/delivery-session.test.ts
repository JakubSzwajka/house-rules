import { afterAll, describe, expect, it } from "@effect/vitest";
import { Clock, Context, Effect, Schema } from "effect";
import {
  defineApi,
  defineContract,
  endpoint,
  implement,
  mount,
  route,
  toFetchHandler,
  toOpenApi,
  toPromiseClient,
} from "../index.ts";
import { answer, makeApp, renameGuest, sessionCallerFor, webRequest } from "./delivery-fixtures.ts";

const SignedIn = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Int,
  name: Schema.String,
});

const signInContract = defineContract("sign_in", {
  description: "Sign in and get a token.",
  input: Schema.Struct({ name: Schema.String }),
  output: SignedIn,
  failure: Schema.Never,
  permission: "public",
});

const signIn = implement(signInContract, ({ name }) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => ({ token: `tok.${name}`, expiresAt: now + 3_600_000, name })),
  ),
);

const signOut = implement(
  defineContract("sign_out", {
    description: "Sign out.",
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.succeed({}),
);

const leaky = implement(
  defineContract("leaky_sign_in", {
    description: "A sign-in whose token is not cookie-safe.",
    input: Schema.Struct({}),
    output: SignedIn,
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.succeed({ token: "has a space secret-123", expiresAt: 0, name: "x" }),
);

const api = defineApi(
  { prefix: "/auth" },
  {
    signIn: endpoint(signInContract, "POST /sign-in", { session: "issue" }),
    signOut: endpoint(signOut.contract, "POST /sign-out", { session: "clear" }),
  },
);

const t = makeApp();
const visitor = () => Effect.succeed(Context.empty());
const routes = [
  ...mount(api, { signIn, signOut }),
  route(leaky, "POST /auth/leaky", { session: "issue" }),
  route(signIn, "POST /auth/token"),
];
const plain = toFetchHandler(t.app, { caller: visitor, session: { cookie: "sid" }, routes });
const proxied = toFetchHandler(t.app, {
  caller: visitor,
  session: { cookie: "sid" },
  origins: ["https://app.example"],
  routes,
});
const prefixed = toFetchHandler(t.app, {
  caller: visitor,
  session: { cookie: "__Host-sid" },
  routes,
});
const member = sessionCallerFor(t.work);
const writes = toFetchHandler(t.app, {
  caller: member,
  session: { cookie: "session" },
  routes: [route(renameGuest, "PATCH /bookings/:id")],
});
afterAll(() =>
  Promise.all([plain.dispose(), proxied.dispose(), prefixed.dispose(), writes.dispose()]).then(
    t.dispose,
  ),
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
  it("a session route needs the handler's session option", () => {
    expect(() => toFetchHandler(t.app, { caller: visitor, routes })).toThrow(
      /sets a session cookie; give toFetchHandler session/u,
    );
  });

  it("refuses a cookie name a browser would not accept", () => {
    for (const cookie of ["", "s id", "sid;", "a=b"]) {
      expect(() => toFetchHandler(t.app, { caller: visitor, session: { cookie }, routes })).toThrow(
        /is not a cookie name/u,
      );
    }
  });

  it("refuses a GET session route, a CSRF opt-out, a second session source and an output without a token", () => {
    expect(() => endpoint(signOut.contract, "GET /sign-out", { session: "clear" })).toThrow(
      /cannot be a GET/u,
    );
    expect(() =>
      route(signIn, "POST /sign-in", {
        session: "issue",
        csrf: { skip: true, reason: "A test." },
      }),
    ).toThrow(/cannot skip CSRF/u);
    expect(() => route(signIn, api.endpoints.signIn, { session: "issue" } as never)).toThrow(
      /takes its session from the endpoint/u,
    );
    // @ts-expect-error: a session issue route needs a token and expiresAt in its output
    expect(() => route(signOut, "POST /sign-out", { session: "issue" })).toThrow(
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
