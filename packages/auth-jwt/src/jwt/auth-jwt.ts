import { Authenticator, TokenRejected } from "@house-rules/application";
import { DateTime, Effect, Layer, Option } from "effect";
import { createLocalJWKSet, createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { clerkIssuer } from "./clerk-issuer.ts";
import { AuthJwtConfigInvalid } from "./config-invalid.ts";
import type { AuthJwtOptions, ClerkOptions } from "./options.ts";
import { principalOf } from "./principal-of.ts";
import { rejectionReason } from "./rejection.ts";

const absoluteUrl = (value: string, option: string, protocols: ReadonlyArray<string>) => {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  return url !== undefined && protocols.includes(url.protocol)
    ? Effect.succeed(url)
    : Effect.fail(
        new AuthJwtConfigInvalid({
          option,
          message: `${option} must be an absolute ${protocols.includes("http:") ? "http(s)" : "https"} URL.`,
        }),
      );
};

const issuerUrl = (value: string) => absoluteUrl(value, "issuer", ["https:", "http:"]);

const jwksUrlOf = (value: string) => absoluteUrl(value, "jwksUrl", ["https:"]);

const toleranceOf = (value: number | undefined) =>
  value === undefined || (Number.isFinite(value) && value >= 0)
    ? Effect.succeed(value ?? 0)
    : Effect.fail(
        new AuthJwtConfigInvalid({
          option: "clockTolerance",
          message: "clockTolerance must be a finite, non-negative number of seconds.",
        }),
      );

const keysOf = Effect.fnUntraced(function* (options: AuthJwtOptions) {
  if (options.jwks !== undefined) return createLocalJWKSet(options.jwks);
  // Keys fetched over plain http could be swapped on the way, so the key set is https only.
  const issuer = options.issuer.replace(/\/+$/u, "");
  const url = yield* jwksUrlOf(options.jwksUrl ?? `${issuer}/.well-known/jwks.json`);
  return createRemoteJWKSet(url);
});

const authenticator = (options: AuthJwtOptions, keys: JWTVerifyGetKey, clockTolerance: number) => ({
  verify: (token: string, verifyOptions?: Readonly<{ audience?: string }>) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const audience = verifyOptions?.audience ?? options.audience;
      const { payload } = yield* Effect.tryPromise({
        try: () =>
          jwtVerify(token, keys, {
            issuer: options.issuer,
            requiredClaims: ["sub", "exp"],
            currentDate: DateTime.toDate(now),
            clockTolerance,
            ...(audience === undefined ? {} : { audience }),
          }),
        catch: (error) => new TokenRejected({ reason: rejectionReason(error) }),
      });
      return yield* Effect.fromOption(principalOf(payload)).pipe(
        Effect.mapError(() => new TokenRejected({ reason: "invalid" })),
      );
    }),
});

const layer = (options: AuthJwtOptions): Layer.Layer<Authenticator, AuthJwtConfigInvalid> =>
  Layer.effect(
    Authenticator,
    Effect.gen(function* () {
      yield* issuerUrl(options.issuer);
      const clockTolerance = yield* toleranceOf(options.clockTolerance);
      const keys = yield* keysOf(options);
      return authenticator(options, keys, clockTolerance);
    }),
  );

const clerk = (options: ClerkOptions): Layer.Layer<Authenticator, AuthJwtConfigInvalid> =>
  Layer.unwrap(
    Option.match(clerkIssuer(options.publishableKey), {
      onNone: () =>
        Effect.fail(
          new AuthJwtConfigInvalid({
            option: "publishableKey",
            message: "publishableKey is not a Clerk pk_test_ or pk_live_ key.",
          }),
        ),
      onSome: (issuer) => Effect.succeed(layer({ ...options, issuer })),
    }),
  );

export const AuthJwt = { layer, clerk, clerkIssuer } as const;
