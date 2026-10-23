import {
  protectedResource,
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
const local = { web: "https://web.invalid" } as const;
export const testIssuers = Effect.gen(function* () {
  const issuers = yield* DevLocalIssuers;
  return { web: yield* issuers.get(local.web) };
});
export const signInConfig = Config.all({
  issuer: Config.String("ACCOUNTS_ISSUER").pipe(Config.withDefault("")),
  signingKey: Config.Redacted("ACCOUNTS_SIGNING_KEY").pipe(Config.withDefault(Redacted.make(""))),
  mcpIssuer: Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")),
});
export const identityOptions = (settings: {
  nodeEnv: string;
  appOrigin: string;
  port: number;
  signIn: Config.Success<typeof signInConfig>;
}) =>
  Effect.gen(function* () {
    const { issuer, signingKey, mcpIssuer } = settings.signIn;
    const nodeEnv = settings.nodeEnv.trim().toLowerCase();
    const missingKey = Redacted.value(signingKey).trim() === "";
    if (nodeEnv === "production" && missingKey)
      return yield* new IdentityProviderInvalid({
        option: "signingKey",
        message: "ACCOUNTS_SIGNING_KEY is required in production.",
      });
    const passwordOptions = {
      issuer: issuer || settings.appOrigin || `http://localhost:${settings.port}`,
    };
    return {
      providers: [
        Identity.passwords(
          missingKey ? { ...passwordOptions, ephemeral: true } : { ...passwordOptions, signingKey },
        ),
        ...(nodeEnv === "development" || nodeEnv === "test"
          ? [Identity.devLocal({ issuer: local.web })]
          : []),
        ...(mcpIssuer === "" ? [] : [Identity.oidc({ issuer: mcpIssuer })]),
      ],
    };
  });
export const webWho = Identity.who({ token: ["bearer", { cookie: "booking_session" }] });
export const resourceOf = (appOrigin: string, issuer: string) =>
  issuer === ""
    ? protectedResource(undefined, "/mcp")
    : protectedResource({
        resource: `${new URL(appOrigin).origin}/mcp`,
        authorizationServers: [issuer],
        resourceName: "Booking",
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
