import { Authenticator, TokenRejected } from "@house-rules/application";
import {
  AuthJwt,
  AuthJwtConfigInvalid,
  AuthJwtLocal,
  type AuthJwtLocalKit,
  type AuthJwtVerifier,
} from "@house-rules/auth-jwt";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { decodeJwt, decodeProtectedHeader, type ProtectedHeaderParameters } from "jose";
import { ApiTokenStore } from "../api-token/token-store.js";
import { ApiTokens, type ApiTokensProvider, makeApiTokens } from "../api-token/tokens.js";
import {
  PasswordIssuer,
  type PasswordIssuerKeyOptions,
  type PasswordIssuerOptions,
} from "../passwords/accounts-issuer.js";
import { requireDevelopmentSigning } from "../passwords/development-signing.js";
import { Credentials, type AcceptedKind, type CredentialKind } from "./credentials.js";
import { DevLocalIssuers } from "./dev-local-issuers.js";
import { IdentityProviderInvalid } from "./provider-invalid.js";

export type PasswordsProvider = Readonly<{ kind: "passwords" }> &
  (PasswordIssuerKeyOptions | (PasswordIssuerOptions & Readonly<{ ephemeral: true }>));
type JwtOptions = Parameters<typeof AuthJwt.layer>[0];
export type OidcProvider = Readonly<{
  kind: "oidc";
  credentialKind?: "jwt" | "session" | "oauth_access";
}> &
  JwtOptions;
export type ClerkProvider = Readonly<{ kind: "clerk"; allowImpersonation?: boolean }> &
  Parameters<typeof AuthJwt.clerkOptions>[0];
export type DevLocalProvider = Readonly<{ kind: "devLocal"; issuer: string }>;
export type IdentityOptions = Readonly<{
  providers: ReadonlyArray<
    PasswordsProvider | OidcProvider | DevLocalProvider | ClerkProvider | ApiTokensProvider
  >;
}>;
export const passwords = (
  options: PasswordIssuerKeyOptions | (PasswordIssuerOptions & Readonly<{ ephemeral: true }>),
): PasswordsProvider => ({ ...options, kind: "passwords" });
export const oidc = (
  options: JwtOptions & { kind?: OidcProvider["credentialKind"] },
): OidcProvider => {
  const { kind, ...verification } = options;
  return { ...verification, kind: "oidc", ...(kind === undefined ? {} : { credentialKind: kind }) };
};
export const clerk = (options: Omit<ClerkProvider, "kind">): ClerkProvider => ({
  ...options,
  kind: "clerk",
});
export const devLocal = (options: { issuer: string }): DevLocalProvider => ({
  ...options,
  kind: "devLocal",
});

type JwtEntry = Readonly<{
  verifier: AuthJwtVerifier;
  kinds: ReadonlyArray<CredentialKind>;
  classify: (
    header: ProtectedHeaderParameters,
    claims: Readonly<Record<string, unknown>>,
  ) => Exclude<CredentialKind, "api_token"> | "unknown";
}>;
const admitted = (kind: CredentialKind | "unknown", accept: ReadonlyArray<AcceptedKind>) =>
  kind !== "unknown" && kind !== "machine" && accept.includes(kind);
const rejected = () => new TokenRejected({ reason: "invalid" });

export const providersLayer = (options: IdentityOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const verifiers = new Map<string, JwtEntry>();
      const locals = new Map<string, AuthJwtLocalKit>();
      let passwordIssuer: PasswordIssuer["Service"] | undefined;
      let tokens: ApiTokens["Service"] | undefined;
      let tokenPrefix: string | undefined;
      for (const provider of options.providers) {
        if (provider.kind === "apiTokens") {
          if (
            tokens !== undefined ||
            !/^[a-zA-Z][a-zA-Z0-9_]*_$/u.test(provider.prefix) ||
            Redacted.value(provider.hmacKey).length === 0
          )
            return yield* new AuthJwtConfigInvalid({
              option: "apiTokens",
              message:
                "Configure one API-token provider with a nonempty HMAC key and a prefix ending in underscore.",
            });
          tokens = yield* makeApiTokens(provider, yield* ApiTokenStore);
          tokenPrefix = provider.prefix;
          continue;
        }
        const jwtOptions =
          provider.kind === "clerk" ? yield* AuthJwt.clerkOptions(provider) : provider;
        if (
          verifiers.has(jwtOptions.issuer) ||
          (provider.kind === "passwords" && passwordIssuer !== undefined)
        )
          return yield* new AuthJwtConfigInvalid({
            option: "providers",
            message: "Provider issuers must be unique and only one passwords provider is allowed.",
          });
        let verifier: AuthJwtVerifier;
        if (provider.kind === "passwords") {
          passwordIssuer = yield* PasswordIssuer.pipe(
            Effect.provide(
              "signingKey" in provider
                ? PasswordIssuer.layer(provider)
                : PasswordIssuer.ephemeral(provider),
            ),
          );
          verifier = yield* AuthJwt.verifier({ ...provider, jwks: passwordIssuer.jwks });
        } else if (provider.kind === "devLocal") {
          yield* requireDevelopmentSigning(
            () =>
              new IdentityProviderInvalid({
                option: "devLocal",
                message: "Development signing requires NODE_ENV development or test.",
              }),
          );
          const local = yield* AuthJwtLocal.make(provider);
          locals.set(provider.issuer, local);
          verifier = yield* AuthJwt.verifier({ issuer: provider.issuer, jwks: local.jwks });
        } else verifier = yield* AuthJwt.verifier(jwtOptions);
        const fixedKind = provider.kind === "oidc" ? (provider.credentialKind ?? "jwt") : "session";
        const classify: JwtEntry["classify"] =
          provider.kind === "clerk"
            ? (header, claims) => {
                if (provider.allowImpersonation === true) {
                  const { act: _act, ...rest } = claims;
                  return AuthJwt.clerkKind(header, rest);
                }
                return AuthJwt.clerkKind(header, claims);
              }
            : () => fixedKind;
        verifiers.set(jwtOptions.issuer, {
          verifier,
          classify,
          kinds: provider.kind === "clerk" ? ["session", "oauth_access", "machine"] : [fixedKind],
        });
      }
      const credentials = Credentials.of({
        verify: (token, verifyOptions) =>
          Effect.gen(function* () {
            // Opaque prefixes win, even if a token contains dots. Never decode or fall back.
            if (
              tokenPrefix !== undefined &&
              token.startsWith(tokenPrefix) &&
              tokens !== undefined
            ) {
              if (!verifyOptions.accept.includes("api_token")) return yield* rejected();
              const resolved = yield* tokens.verify(token);
              return {
                kind: "api_token" as const,
                principal: {
                  issuer: tokenPrefix,
                  subject: resolved.actorId,
                  audience: [],
                  scopes: resolved.scopes,
                  claims: {},
                },
                actorId: Option.some(resolved.actorId),
              };
            }
            if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))
              return yield* rejected();
            const unverified = yield* Effect.try({
              try: () => ({ claims: decodeJwt(token), header: decodeProtectedHeader(token) }),
              catch: rejected,
            });
            const entry =
              unverified.claims.iss === undefined
                ? undefined
                : verifiers.get(unverified.claims.iss);
            if (entry === undefined) return yield* new TokenRejected({ reason: "wrong_issuer" });
            if (
              !entry.kinds.some((kind) => admitted(kind, verifyOptions.accept)) ||
              !admitted(entry.classify(unverified.header, unverified.claims), verifyOptions.accept)
            )
              return yield* rejected();
            const { header, principal } = yield* entry.verifier.verify(token, verifyOptions);
            const kind = entry.classify(header, { ...principal.claims, sub: principal.subject });
            if (!admitted(kind, verifyOptions.accept) || kind === "unknown")
              return yield* rejected();
            // JWT entries cannot supply an ActorId. Login resolution always uses the slots.
            return { kind, principal, actorId: Option.none() };
          }),
      });
      const authenticator = Authenticator.of({
        verify: (token, opts) =>
          credentials.verify(token, { ...opts, accept: ["session", "jwt"] }).pipe(
            Effect.map(({ principal }) => principal),
            Effect.mapError((error) =>
              error._tag === "TokenRejected" ? error : new TokenRejected({ reason: "unavailable" }),
            ),
          ),
      });
      const context = Context.make(Authenticator, authenticator).pipe(
        Context.add(Credentials, credentials),
        Context.add(DevLocalIssuers, DevLocalIssuers.from(locals)),
      );
      return Layer.succeedContext(
        context.pipe(
          (ctx) =>
            passwordIssuer === undefined ? ctx : Context.add(ctx, PasswordIssuer, passwordIssuer),
          (ctx) => (tokens === undefined ? ctx : Context.add(ctx, ApiTokens, tokens)),
        ),
      );
    }),
  );
