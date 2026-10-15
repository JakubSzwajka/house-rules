import { Clock, Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  calculateJwkThumbprint,
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JSONWebKeySet,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { AccountsIssuerConfigInvalid } from "./issuer-config-invalid.js";
import type { SignedIn } from "./signed-in.js";

const algorithm = "ES256";
const reservedClaims: ReadonlySet<string> = new Set([
  "iss",
  "sub",
  "aud",
  "exp",
  "iat",
  "nbf",
  "jti",
]);

export type AccountsIssuerOptions = Readonly<{
  issuer: string;
  audience?: string;
  ttlSeconds?: number;
}>;

export type AccountsIssuerKeyOptions = AccountsIssuerOptions &
  Readonly<{ signingKey: Redacted.Redacted<string> }>;

export type AccountsIssuerService = Readonly<{
  issuer: string;
  audience?: string;
  ttlSeconds: number;
  jwks: JSONWebKeySet;
  sign: (subject: string, claims?: Readonly<Record<string, unknown>>) => Effect.Effect<SignedIn>;
}>;

const PublicJwk = Schema.Struct({
  kty: Schema.Literal("EC"),
  crv: Schema.Literal("P-256"),
  x: Schema.String,
  y: Schema.String,
});
type PublicJwk = typeof PublicJwk.Type;

const PrivateJwk = Schema.Struct({
  ...PublicJwk.fields,
  d: Schema.String,
  kid: Schema.optional(Schema.String),
});

const invalid = (option: string, message: string) =>
  new AccountsIssuerConfigInvalid({ option, message });

const checked = Effect.fnUntraced(function* (options: AccountsIssuerOptions) {
  const url = URL.canParse(options.issuer) ? new URL(options.issuer) : undefined;
  if (url === undefined || !["https:", "http:"].includes(url.protocol)) {
    return yield* invalid("issuer", "issuer must be an absolute http(s) URL.");
  }
  const ttlSeconds = options.ttlSeconds ?? 3600;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    return yield* invalid("ttlSeconds", "ttlSeconds must be a positive whole number of seconds.");
  }
  return ttlSeconds;
});

const serviceOf = (
  options: AccountsIssuerOptions,
  ttlSeconds: number,
  privateKey: CryptoKey | Uint8Array,
  publicKey: JWK & { kid: string },
): AccountsIssuerService => ({
  issuer: options.issuer,
  ttlSeconds,
  jwks: { keys: [{ ...publicKey, alg: algorithm, use: "sig" }] },
  ...(options.audience === undefined ? {} : { audience: options.audience }),
  sign: (subject, claims = {}) =>
    Effect.gen(function* sign() {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const expires = now + ttlSeconds;
      // Reserved claims come last, so a caller cannot extend a token's life or retarget it.
      const payload: JWTPayload = {
        ...Object.fromEntries(Object.entries(claims).filter(([name]) => !reservedClaims.has(name))),
        iss: options.issuer,
        sub: subject,
        iat: now,
        exp: expires,
        ...(options.audience === undefined ? {} : { aud: options.audience }),
      };
      const token = yield* Effect.promise(() =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: algorithm, kid: publicKey.kid, typ: "JWT" })
          .sign(privateKey),
      );
      return { token, expiresAt: expires * 1000 };
    }),
});

const publicPart = ({ kty, crv, x, y }: PublicJwk, kid?: string) =>
  Effect.promise(() => calculateJwkThumbprint({ kty, crv, x, y })).pipe(
    Effect.map((thumbprint) => ({ kty, crv, x, y, kid: kid ?? thumbprint })),
  );

const exported = <S extends Schema.Top>(schema: S, key: CryptoKey) =>
  Effect.promise(() => exportJWK(key)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.orDie,
  );

const keyInvalid = () =>
  invalid("signingKey", "signingKey must be a private EC P-256 JWK, as JSON.");

const fromKey = Effect.fnUntraced(function* (options: AccountsIssuerKeyOptions) {
  const ttlSeconds = yield* checked(options);
  // The decode error would quote the input, which is the private key, so it is replaced whole.
  const jwk = yield* Schema.decodeEffect(Schema.fromJsonString(PrivateJwk))(
    Redacted.value(options.signingKey),
  ).pipe(Effect.mapError(keyInvalid));
  const privateKey = yield* Effect.tryPromise({
    try: () => importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, algorithm),
    catch: keyInvalid,
  });
  const publicKey = yield* publicPart(jwk, jwk.kid);
  return serviceOf(options, ttlSeconds, privateKey, publicKey);
});

const ephemeralService = Effect.fnUntraced(function* (options: AccountsIssuerOptions) {
  const ttlSeconds = yield* checked(options);
  const pair = yield* Effect.promise(() => generateKeyPair(algorithm));
  const publicKey = yield* publicPart(yield* exported(PublicJwk, pair.publicKey));
  yield* Effect.logWarning(
    "AccountsIssuer is signing with a temporary key. Every token dies with this process. Development only: set ACCOUNTS_SIGNING_KEY anywhere else.",
  );
  return serviceOf(options, ttlSeconds, pair.privateKey, publicKey);
});

export class AccountsIssuer extends Context.Service<AccountsIssuer, AccountsIssuerService>()(
  "@example/accounts/AccountsIssuer",
) {
  // Signs with the private JWK the app holds, such as ACCOUNTS_SIGNING_KEY from .env.local.
  static readonly layer = (
    options: AccountsIssuerKeyOptions,
  ): Layer.Layer<AccountsIssuer, AccountsIssuerConfigInvalid> =>
    Layer.effect(AccountsIssuer, fromKey(options));

  // Development only: a key made at startup and kept in memory. The app decides when to allow it.
  static readonly ephemeral = (
    options: AccountsIssuerOptions,
  ): Layer.Layer<AccountsIssuer, AccountsIssuerConfigInvalid> =>
    Layer.effect(AccountsIssuer, ephemeralService(options));

  // A fresh private JWK as JSON, for ACCOUNTS_SIGNING_KEY in .env.local.
  static readonly newSigningKey: Effect.Effect<Redacted.Redacted<string>> = Effect.promise(() =>
    generateKeyPair(algorithm, { extractable: true }),
  ).pipe(
    Effect.flatMap((pair) => exported(PrivateJwk, pair.privateKey)),
    Effect.flatMap((jwk) =>
      publicPart(jwk, jwk.kid).pipe(
        Effect.map(({ kid }) => Redacted.make(JSON.stringify({ ...jwk, kid }))),
      ),
    ),
  );
}
