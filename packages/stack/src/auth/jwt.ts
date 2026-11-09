import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  importSPKI,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { AuthProvider } from "./auth-provider.ts";
import { credentialOf } from "./credential.ts";
import type { Principal } from "./principal.ts";

export type Claims = JWTPayload;

export interface AgentClaims {
  readonly id: string;
  readonly name: string;
  readonly forPerson: string;
}

export type JwtKey =
  | { readonly jwksUrl: string }
  | { readonly jwks: JSONWebKeySet }
  | { readonly publicKey: string; readonly algorithm?: string }
  | { readonly secret: string };

export interface JwtOptions {
  readonly key: JwtKey;
  readonly issuer: string;
  readonly audience?: string | ReadonlyArray<string>;
  readonly cookie?: string;
  readonly clockTolerance?: number;
  readonly subject?: (claims: Claims) => string | undefined;
  readonly orgId?: (claims: Claims) => string | null;
  readonly roles?: (claims: Claims) => ReadonlyArray<string>;
  readonly agent?: (claims: Claims) => AgentClaims | undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const agentFromAct = (claims: Claims): AgentClaims | undefined => {
  const act = claims["act"];
  if (typeof act !== "object" || act === null) return undefined;
  const actor = act as Record<string, unknown>;
  const id = text(actor["sub"]);
  const forPerson = text(claims.sub);
  if (id === undefined || forPerson === undefined) return undefined;
  return { id, name: text(actor["name"]) ?? id, forPerson };
};

export const principalWithAgent = (
  principal: Principal,
  claims: Claims,
  agent: ((claims: Claims) => AgentClaims | undefined) | undefined,
): Principal => {
  const found = agent === undefined ? undefined : agent(claims);
  return found === undefined
    ? principal
    : {
        ...principal,
        subject: found.id,
        agent: { name: found.name, forPerson: found.forPerson },
      };
};

const stringsOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];

const signedOutCodes = new Set([
  errors.JWTClaimValidationFailed.code,
  errors.JWTExpired.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
]);

class TokenRefused extends Data.TaggedError("TokenRefused")<{
  readonly badToken: boolean;
  readonly reason: string;
}> {}

const refusal = (error: unknown): TokenRefused =>
  new TokenRefused({
    badToken: error instanceof errors.JOSEError && signedOutCodes.has(error.code),
    reason:
      error instanceof errors.JOSEError
        ? error.code
        : error instanceof globalThis.Error
          ? error.name
          : "unknown",
  });

const keyOf = (
  key: JwtKey,
): Effect.Effect<{ readonly key: JWTVerifyGetKey; readonly algorithms?: Array<string> }> => {
  if ("jwksUrl" in key) return Effect.succeed({ key: createRemoteJWKSet(new URL(key.jwksUrl)) });
  if ("jwks" in key) return Effect.succeed({ key: createLocalJWKSet(key.jwks) });
  if ("secret" in key) {
    const secret = new TextEncoder().encode(key.secret);
    return Effect.succeed({ key: () => secret, algorithms: ["HS256"] });
  }
  const algorithm = key.algorithm ?? "RS256";
  return Effect.map(
    Effect.promise(() => importSPKI(key.publicKey, algorithm)),
    (imported) => ({ key: () => imported, algorithms: [algorithm] }),
  );
};

export const tokenProvider = (
  options: Omit<JwtOptions, "subject" | "orgId" | "roles" | "agent"> & {
    readonly algorithms?: ReadonlyArray<string>;
  },
  principalOf: (claims: Claims) => Option.Option<Principal>,
) =>
  Layer.effect(
    AuthProvider,
    Effect.gen(function* () {
      const { key, algorithms } = yield* keyOf(options.key);
      const verifyOptions = {
        issuer: options.issuer,
        audience: options.audience === undefined ? undefined : [options.audience].flat(),
        algorithms: options.algorithms === undefined ? algorithms : [...options.algorithms],
        clockTolerance: options.clockTolerance,
      };
      const verify = (token: string) =>
        Effect.tryPromise({
          try: () => jwtVerify(token, key, verifyOptions),
          catch: refusal,
        }).pipe(
          Effect.map(({ payload }) => principalOf(payload)),
          Effect.catchTag("TokenRefused", ({ badToken, reason }) =>
            badToken
              ? Effect.succeedNone
              : Effect.as(
                  Effect.logWarning(
                    "Could not verify a session token; treating it as signed out",
                  ).pipe(Effect.annotateLogs({ issuer: options.issuer, reason })),
                  Option.none<Principal>(),
                ),
          ),
        );
      return {
        authenticate: (headers) =>
          Option.match(credentialOf(headers, options.cookie ?? "__session"), {
            onNone: () => Effect.succeedNone,
            onSome: verify,
          }),
      };
    }),
  );

export const jwt = (options: JwtOptions) =>
  tokenProvider(options, (claims) => {
    const subject = options.subject === undefined ? claims.sub : options.subject(claims);
    if (subject === undefined || subject === "") return Option.none();
    return Option.some(
      principalWithAgent(
        {
          subject,
          orgId: options.orgId === undefined ? null : options.orgId(claims),
          roles: options.roles === undefined ? stringsOf(claims["roles"]) : options.roles(claims),
        },
        claims,
        options.agent,
      ),
    );
  });
