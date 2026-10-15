import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { sessionCookie } from "../composition/callers.js";
import { app } from "../composition/index.js";
import { handler } from "../main.js";

afterAll(() => handler.dispose().then(app.dispose));

const page = "https://booking.example";
const password = "a long enough secret";

type Answer = Readonly<{ status: number; headers: Headers; body: unknown }>;

const send = (path: string, init: RequestInit = {}): Effect.Effect<Answer> =>
  Effect.promise(() => handler(new Request(`${page}${path}`, init) as Request)).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, headers: response.headers, body })),
      ),
    ),
  );

const post = (path: string, body: unknown, headers: Record<string, string> = { origin: page }) =>
  send(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const cookieOf = (answer: Answer): string => {
  const set = answer.headers.get("set-cookie") ?? "";
  expect(set.startsWith(`${sessionCookie}=`)).toBe(true);
  return set.split(";")[0] ?? "";
};

const signedUp = (email: string) =>
  post("/api/sign-up", { email, password, displayName: "Cookie" }).pipe(
    Effect.tap((answer) => Effect.sync(() => expect(answer.status).toBe(201))),
  );

it.effect("sign-up and sign-in set an HttpOnly, Lax, Secure cookie and return no token", () =>
  Effect.gen(function* issues() {
    const up = yield* signedUp("set@example.test");
    const pattern = new RegExp(
      `^${sessionCookie}=[\\w-]+\\.[\\w-]+\\.[\\w-]+; Path=/; Max-Age=(?:3599|3600); HttpOnly; SameSite=Lax; Secure$`,
      "u",
    );
    expect(up.headers.get("set-cookie")).toMatch(pattern);
    expect(Object.keys(up.body as object).sort()).toEqual(["accountId", "expiresAt"]);
    const signIn = yield* post("/api/sign-in", { email: "set@example.test", password });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-cookie")).toMatch(pattern);
    expect(Object.keys(signIn.body as object)).toEqual(["expiresAt"]);
    expect(JSON.stringify(signIn.body)).not.toContain(cookieOf(signIn).split("=")[1]);
  }),
);

it.effect("a reload with only the cookie is still signed in; sign-out clears it", () =>
  Effect.gen(function* reload() {
    const cookie = cookieOf(yield* signedUp("reload@example.test"));
    const me = yield* send("/api/me", { headers: { cookie } });
    expect(me).toMatchObject({ status: 200, body: { displayName: "Cookie" } });
    const out = yield* post("/api/sign-out", {}, { origin: page, cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toBe(
      `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    );
    // The browser drops the cookie, so the next request has none.
    const after = yield* send("/api/me");
    expect(after).toMatchObject({ status: 401, body: { error: { code: "token_missing" } } });
  }),
);

it.effect("a write carrying the cookie from another origin is 403 cross_origin", () =>
  Effect.gen(function* crossOrigin() {
    const cookie = cookieOf(yield* signedUp("csrf@example.test"));
    const evil = { origin: "https://evil.example", cookie };
    const booked = yield* post("/api/bookings", { id: "csrf-1", guestName: "Eve" }, evil);
    expect(booked).toMatchObject({ status: 403, body: { error: { code: "cross_origin" } } });
    const signIn = yield* post("/api/sign-in", { email: "csrf@example.test", password }, evil);
    expect(signIn.status).toBe(403);
    expect(signIn.headers.get("set-cookie")).toBeNull();
    const own = yield* post(
      "/api/bookings",
      { id: "csrf-1", guestName: "Eve" },
      { ...evil, origin: page },
    );
    expect(own.status).toBe(201);
  }),
);

it.effect("a script signs in on /api/token with no Origin and uses the bearer token", () =>
  Effect.gen(function* bearerPath() {
    yield* signedUp("script@example.test");
    const signIn = yield* post("/api/token", { email: "script@example.test", password }, {});
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("set-cookie")).toBeNull();
    const { token } = signIn.body as { token: string };
    const me = yield* send("/api/me", { headers: { authorization: `Bearer ${token}` } });
    expect(me).toMatchObject({ status: 200, body: { displayName: "Cookie" } });
    // A bearer header wins over the cookie: a bad header is not rescued by a good cookie.
    const cookie = `${sessionCookie}=${token}`;
    const bad = yield* send("/api/me", { headers: { authorization: "Bearer nope", cookie } });
    expect(bad).toMatchObject({ status: 401, body: { error: { code: "token_invalid" } } });
  }),
);
