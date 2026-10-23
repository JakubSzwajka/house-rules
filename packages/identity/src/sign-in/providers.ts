import { Authenticator, TokenRejected } from "@house-rules/application";
import {
  AuthJwt,
  AuthJwtConfigInvalid,
  AuthJwtLocal,
  type AuthJwtLocalKit,
} from "@house-rules/auth-jwt";
import { Context, Effect, Layer } from "effect";
import { requireDevelopmentSigning } from "../passwords/development-signing.js";
import { DevLocalIssuers } from "./dev-local-issuers.js";
import { IdentityProviderInvalid } from "./provider-invalid.js";
import { decodeJwt } from "jose";
import {
  PasswordIssuer,
  type PasswordIssuerKeyOptions,
  type PasswordIssuerOptions,
} from "../passwords/accounts-issuer.js";

export type PasswordsProvider = Readonly<{ kind: "passwords" }> &
  (PasswordIssuerKeyOptions | (PasswordIssuerOptions & Readonly<{ ephemeral: true }>));
export type OidcProvider = Readonly<{ kind: "oidc" }> & Parameters<typeof AuthJwt.layer>[0];
export type DevLocalProvider = Readonly<{ kind: "devLocal"; issuer: string }>;
export type IdentityOptions = Readonly<{
  providers: ReadonlyArray<PasswordsProvider | OidcProvider | DevLocalProvider>;
}>;

export const passwords = (
  options: PasswordIssuerKeyOptions | (PasswordIssuerOptions & Readonly<{ ephemeral: true }>),
): PasswordsProvider => ({
  ...options,
  kind: "passwords",
});
export const oidc = (options: Omit<OidcProvider, "kind">): OidcProvider => ({
  ...options,
  kind: "oidc",
});

export const devLocal = (options: { issuer: string }): DevLocalProvider => ({
  ...options,
  kind: "devLocal",
});

export const providersLayer = (options: IdentityOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const verifiers = new Map<string, Authenticator["Service"]>();
      const locals = new Map<string, AuthJwtLocalKit>();
      let passwordIssuer: PasswordIssuer["Service"] | undefined;
      for (const provider of options.providers) {
        if (verifiers.has(provider.issuer) || (provider.kind === "passwords" && passwordIssuer)) {
          return yield* new AuthJwtConfigInvalid({
            option: "providers",
            message: "Provider issuers must be unique and only one passwords provider is allowed.",
          });
        }
        if (provider.kind === "passwords") {
          passwordIssuer = yield* PasswordIssuer.pipe(
            Effect.provide(
              "signingKey" in provider
                ? PasswordIssuer.layer(provider)
                : PasswordIssuer.ephemeral(provider),
            ),
          );
          verifiers.set(
            provider.issuer,
            yield* Authenticator.pipe(
              Effect.provide(AuthJwt.layer({ ...provider, jwks: passwordIssuer.jwks })),
            ),
          );
        } else if (provider.kind === "devLocal") {
          const invalid = () =>
            new IdentityProviderInvalid({
              option: "devLocal",
              message: "Development signing requires NODE_ENV development or test.",
            });
          yield* requireDevelopmentSigning(invalid);
          const local = yield* AuthJwtLocal.make(provider);
          locals.set(provider.issuer, local);
          verifiers.set(provider.issuer, yield* Authenticator.pipe(Effect.provide(local.layer)));
        } else {
          verifiers.set(
            provider.issuer,
            yield* Authenticator.pipe(Effect.provide(AuthJwt.layer(provider))),
          );
        }
      }
      const authenticator = Authenticator.of({
        verify: (token, verifyOptions) =>
          Effect.gen(function* () {
            // Decode only to select a verifier. Its signature and issuer checks remain mandatory.
            const payload = yield* Effect.try({
              try: () => decodeJwt(token),
              catch: () => new TokenRejected({ reason: "invalid" }),
            });
            const verifier = payload.iss === undefined ? undefined : verifiers.get(payload.iss);
            if (verifier === undefined) return yield* new TokenRejected({ reason: "wrong_issuer" });
            return yield* verifier.verify(token, verifyOptions);
          }),
      });
      const context = Context.make(Authenticator, authenticator).pipe(
        Context.add(DevLocalIssuers, DevLocalIssuers.from(locals)),
      );
      return Layer.succeedContext(
        passwordIssuer === undefined
          ? context
          : Context.add(context, PasswordIssuer, passwordIssuer),
      );
    }),
  );
