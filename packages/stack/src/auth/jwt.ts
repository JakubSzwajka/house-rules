import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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
import { AgentId, PersonId } from "../actor/actor.ts";
import { AuthProvider } from "./auth-provider.ts";
import { credentialOf } from "./credential.ts";
import type { Principal } from "./principal.ts";

export type Claims = JWTPayload;

export interface AgentClaims {
  readonly id: string;
  readonly name: string;
  readonly forPerson: string;
}

export type Delegation =
  | { readonly _tag: "None" }
  | { readonly _tag: "Agent"; readonly agent: AgentClaims }
  | { readonly _tag: "Malformed"; readonly reason: string };

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
  readonly agent?: (claims: Claims) => Delegation;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const malformed = (reason: string): Delegation => ({ _tag: "Malformed", reason });
const isAgentId = Schema.is(AgentId);
const isPersonId = Schema.is(PersonId);

export const agentFromAct = (claims: Claims): Delegation => {
  if (!Object.hasOwn(claims, "act")) return { _tag: "None" };
  const act = claims["act"];
  if (typeof act !== "object" || act === null || Array.isArray(act))
    return malformed("act is not an object");
  const actor = act as Record<string, unknown>;
  const id = text(actor["sub"]);
  if (id === undefined || !isAgentId(id)) return malformed("act.sub is not an agent id");
  const forPerson = text(claims.sub);
  if (forPerson === undefined || !isPersonId(forPerson)) return malformed("sub is not a person id");
  if (Object.hasOwn(actor, "name") && text(actor["name"]) === undefined)
    return malformed("act.name is not a name");
  return { _tag: "Agent", agent: { id, name: text(actor["name"]) ?? id, forPerson } };
};

export const principalWithAgent = (
  principal: Principal,
  claims: Claims,
  agent: ((claims: Claims) => Delegation) | undefined,
): Option.Option<Principal> => {
  const found: Delegation = agent === undefined ? { _tag: "None" } : agent(claims);
  switch (found._tag) {
    case "None":
      return Option.some(principal);
    case "Malformed":
      return Option.none();
    case "Agent":
      return Option.some({
        ...principal,
        subject: found.agent.id,
        agent: { name: found.agent.name, forPerson: found.agent.forPerson },
      });
  }
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
        requiredClaims: ["exp"],
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
    return principalWithAgent(
      {
        subject,
        orgId: options.orgId === undefined ? null : options.orgId(claims),
        roles: options.roles === undefined ? stringsOf(claims["roles"]) : options.roles(claims),
      },
      claims,
      options.agent,
    );
  });
