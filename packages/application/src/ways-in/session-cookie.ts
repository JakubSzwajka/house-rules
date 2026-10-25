import { Clock, Effect, Exit, Schema } from "effect";
import { bodySchemaOf } from "../contract/session.ts";
import { sourceOrigin } from "./csrf.ts";
import type { Endpoint } from "../contract/endpoint.ts";

export type SessionOptions = Readonly<{ cookie: string }>;

export type SessionCookie = Readonly<{ name: string; alwaysSecure: boolean }>;

const rfc6265Token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const rfc6265CookieOctets = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/u;

export const checkSession = (
  options: SessionOptions | undefined,
  routes: ReadonlyArray<Endpoint>,
): SessionCookie | undefined => {
  // Mount time, not a request: a session route with nowhere to put the cookie would answer without it.
  const needing = routes.find((each) => each.session !== "none");
  if (options === undefined) {
    if (needing === undefined) return undefined;
    throw new TypeError(
      `route ${needing.method} ${needing.path} sets a session cookie; give toFetchHandler session: { cookie }`,
    );
  }
  if (!rfc6265Token.test(options.cookie)) {
    throw new TypeError(`session: ${JSON.stringify(options.cookie)} is not a cookie name`);
  }
  // __Host- and __Secure- names are dropped by the browser unless the cookie is Secure.
  const alwaysSecure = /^__(?:host|secure)-/iu.test(options.cookie);
  return { name: options.cookie, alwaysSecure };
};

const secureFor = (cookie: SessionCookie, request: Request): boolean =>
  cookie.alwaysSecure ||
  new URL(request.url).protocol === "https:" ||
  // Behind a TLS proxy the request URL is http; the page's own origin, which passed CSRF, says https.
  sourceOrigin(request)?.startsWith("https://") === true;

const setCookie = (
  cookie: SessionCookie,
  request: Request,
  value: string,
  maxAge: number,
): string =>
  [
    `${cookie.name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secureFor(cookie, request) ? ["Secure"] : []),
  ].join("; ");

export const clearedCookie = (cookie: SessionCookie, request: Request): string =>
  setCookie(cookie, request, "", 0);

type Issued = Readonly<{ body: unknown; setCookie?: string }>;

const grantOf = (value: unknown): Readonly<{ token: string; expiresAt: number }> | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { token, expiresAt } = value as Readonly<Record<string, unknown>>;
  return typeof token === "string" &&
    rfc6265CookieOctets.test(token) &&
    typeof expiresAt === "number" &&
    Number.isFinite(expiresAt)
    ? { token, expiresAt }
    : undefined;
};

export const issueSession = (
  cookie: SessionCookie,
  route: Endpoint,
  request: Request,
  value: unknown,
): Effect.Effect<Issued | undefined> =>
  Effect.gen(function* issue() {
    const checked = yield* Effect.exit(
      Schema.encodeUnknownEffect(Schema.toCodecJson(route.feature.output))(value),
    );
    if (Exit.isFailure(checked)) {
      yield* Effect.logError("Session output did not encode");
      return undefined;
    }
    const hasToken = typeof value === "object" && value !== null && "token" in value;
    const grant = grantOf(value);
    if (hasToken && grant === undefined) {
      // Never the value itself: it carries the token.
      yield* Effect.logError("Session output has no cookie-safe token and numeric expiresAt");
      return undefined;
    }
    const body = Schema.toCodecJson(bodySchemaOf(route.feature, "issue"));
    const encoded = yield* Effect.exit(Schema.encodeUnknownEffect(body)(value));
    if (Exit.isFailure(encoded)) {
      // No cause: a schema issue prints the input, and the input holds the token.
      yield* Effect.logError("Session output did not encode");
      return undefined;
    }
    if (grant === undefined) return { body: encoded.value };
    const now = yield* Clock.currentTimeMillis;
    // expiresAt is epoch milliseconds, as Date.now(); the cookie dies with the token.
    const maxAge = Math.max(0, Math.floor((grant.expiresAt - now) / 1000));
    return { body: encoded.value, setCookie: setCookie(cookie, request, grant.token, maxAge) };
  });
