import {
  Authenticator,
  TokenRejected,
  Refused,
  type ProtectedResource,
  type WhoSocket,
} from "@house-rules/application";
import {
  DevLocalIssuers,
  FirstSignIn,
  Identity,
  IdentityProviderInvalid,
} from "@house-rules/identity";
import { Config, Effect, Redacted } from "effect";

export { FirstSignIn as FirstSignInSlot };
const local = { web: "https://web.invalid", partner: "https://partner.invalid" } as const;
export const testIssuers = Effect.gen(function* () {
  const issuers = yield* DevLocalIssuers;
  return { web: yield* issuers.get(local.web), partner: yield* issuers.get(local.partner) };
});
export const identityOptions = (settings: { nodeEnv?: string; issuer?: string } = {}) =>
  Effect.gen(function* () {
    const issuer = yield* Config.String("ACCOUNTS_ISSUER").pipe(Config.withDefault(""));
    const origin = yield* Config.String("APP_ORIGIN").pipe(Config.withDefault(""));
    const port = yield* Config.Int("PORT").pipe(Config.withDefault(3000));
    const signingKey = yield* Config.Redacted("ACCOUNTS_SIGNING_KEY").pipe(
      Config.withDefault(Redacted.make("")),
    );
    const environment =
      settings.nodeEnv ??
      (yield* Config.String("NODE_ENV").pipe(Config.withDefault("development")));
    if (environment === "production")
      return yield* new IdentityProviderInvalid({
        option: "devLocal",
        message: "Development signing is forbidden in production.",
      });
    const mcpIssuer =
      settings.issuer ?? (yield* Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")));
    const passwordOptions = { issuer: issuer || origin || `http://localhost:${port}` };
    return {
      providers: [
        Identity.passwords(
          Redacted.value(signingKey).trim() === ""
            ? { ...passwordOptions, ephemeral: true }
            : { ...passwordOptions, signingKey },
        ),
        Identity.devLocal({ issuer: local.web }),
        Identity.devLocal({ issuer: local.partner }),
        ...(mcpIssuer === "" ? [] : [Identity.oidc({ issuer: mcpIssuer })]),
      ],
    };
  });
export const webWho = Identity.who({ token: ["bearer", { cookie: "booking_session" }] });
export const localWho = (way: "web" | "partner") => ({
  resolve: (incoming: { headers: Headers; url: string }) =>
    Effect.gen(function* () {
      const auth = yield* Authenticator;
      return yield* Identity.who({ token: "bearer" })
        .resolve(incoming)
        .pipe(
          Effect.provideService(Authenticator, {
            verify: (token, options) =>
              auth.verify(token, options).pipe(
                Effect.filterOrFail(
                  (principal) => principal.issuer === local[way],
                  () => new TokenRejected({ reason: "wrong_issuer" }),
                ),
              ),
          }),
        );
    }),
});
export const mcpWho = (resource: ProtectedResource) =>
  ({
    resolve: (incoming) =>
      Effect.gen(function* () {
        if (!resource.configured)
          return yield* new Refused({
            status: 503,
            code: "not_configured",
            message: "MCP is not configured.",
          });
        return yield* Identity.who({
          token: "bearer",
          audience: resource.metadata.resource,
          challenge: resource.challenge,
        }).resolve(incoming);
      }),
  }) satisfies WhoSocket<
    | import("@house-rules/application").Authenticator
    | import("@house-rules/identity").ActorResolver
    | FirstSignIn
  >;
