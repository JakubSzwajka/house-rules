import { Authenticator, type Principal, TokenRejected } from "@house-rules/application";
import { DateTime, Effect, Layer, Predicate } from "effect";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTHeaderParameters,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { clerkIssuer } from "./clerk-issuer.ts";
import { clerkKind } from "./clerk-kind.ts";
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

export const issuerUrl = (value: string) => absoluteUrl(value, "issuer", ["https:", "http:"]);

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

export type VerifiedToken = Readonly<{ header: JWTHeaderParameters; principal: Principal }>;

export type AuthJwtVerifier = Readonly<{
  verify: (
    token: string,
    options?: Readonly<{ audience?: string }>,
  ) => Effect.Effect<VerifiedToken, TokenRejected>;
}>;

const signedVerifier = (
  options: AuthJwtOptions,
  keys: JWTVerifyGetKey,
  clockTolerance: number,
): AuthJwtVerifier => ({
  verify: (token: string, verifyOptions?: Readonly<{ audience?: string }>) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const audience = verifyOptions?.audience ?? options.audience;
      const { payload, protectedHeader } = yield* Effect.tryPromise({
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
      const azp = payload["azp"];
      if (
        options.authorizedParties !== undefined &&
        Object.hasOwn(payload, "azp") &&
        (!Predicate.isString(azp) || !options.authorizedParties.includes(azp))
      ) {
        return yield* new TokenRejected({ reason: "invalid" });
      }
      if (options.rejectPending === true && payload["sts"] === "pending") {
        return yield* new TokenRejected({ reason: "invalid" });
      }
      const principal = yield* Effect.fromOption(principalOf(payload)).pipe(
        Effect.mapError(() => new TokenRejected({ reason: "invalid" })),
      );
      return { header: protectedHeader, principal };
    }),
});

export const authenticator = (
  options: AuthJwtOptions,
  keys: JWTVerifyGetKey,
  clockTolerance: number,
): Authenticator["Service"] => {
  const checked = signedVerifier(options, keys, clockTolerance);
  return {
    verify: (token, verifyOptions) =>
      Effect.map(checked.verify(token, verifyOptions), ({ principal }) => principal),
  };
};

const verifier = Effect.fnUntraced(function* (options: AuthJwtOptions) {
  yield* issuerUrl(options.issuer);
  const clockTolerance = yield* toleranceOf(options.clockTolerance);
  const keys = yield* keysOf(options);
  return signedVerifier(options, keys, clockTolerance);
});

const layer = (options: AuthJwtOptions): Layer.Layer<Authenticator, AuthJwtConfigInvalid> =>
  Layer.effect(
    Authenticator,
    Effect.map(verifier(options), (checked) => ({
      verify: (token, verifyOptions) =>
        Effect.map(checked.verify(token, verifyOptions), ({ principal }) => principal),
    })),
  );

const clerkOptions = Effect.fnUntraced(function* (
  options: ClerkOptions,
): Effect.fn.Return<AuthJwtOptions, AuthJwtConfigInvalid> {
  const issuer = yield* Effect.fromOption(clerkIssuer(options.publishableKey)).pipe(
    Effect.mapError(
      () =>
        new AuthJwtConfigInvalid({
          option: "publishableKey",
          message: "publishableKey is not a Clerk pk_test_ or pk_live_ key.",
        }),
    ),
  );
  if (
    !Array.isArray(options.authorizedParties) ||
    options.authorizedParties.length === 0 ||
    !options.authorizedParties.every((party) => Predicate.isString(party) && party.trim() !== "")
  ) {
    return yield* new AuthJwtConfigInvalid({
      option: "authorizedParties",
      message: "authorizedParties must be a nonempty list of nonempty strings.",
    });
  }
  const clockTolerance = yield* toleranceOf(options.clockTolerance ?? 5);
  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    clockTolerance,
    authorizedParties: [...options.authorizedParties],
    ...(options.audience === undefined ? {} : { audience: options.audience }),
    ...(options.jwks === undefined ? {} : { jwks: options.jwks }),
    ...(options.rejectPending === undefined ? {} : { rejectPending: options.rejectPending }),
  };
});

const clerk = (options: ClerkOptions): Layer.Layer<Authenticator, AuthJwtConfigInvalid> =>
  Layer.unwrap(Effect.map(clerkOptions(options), layer));

export const AuthJwt = { layer, verifier, clerk, clerkOptions, clerkIssuer, clerkKind } as const;
