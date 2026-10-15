import { type Accounts, AccountsIssuer, type AccountsIssuerConfigInvalid } from "@example/accounts";
import { type Authenticator, type Principal, Refused } from "@house-rules/application";
import { AuthJwt, type AuthJwtConfigInvalid, type AuthJwtOptions } from "@house-rules/auth-jwt";
import { UnitOfWork } from "@house-rules/domain";
import { FirstSignIn, Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import { SourceError } from "effect/ConfigProvider";
import { McpAuthenticator } from "./mcp-authenticator.js";

export type AccountsSettings = Readonly<{
  issuer: string;
  signingKey: Option.Option<Redacted.Redacted<string>>;
}>;

export type SignInSettings = Readonly<{
  accounts: AccountsSettings;
  mcp: Option.Option<AuthJwtOptions>;
}>;

export const localSignIn: SignInSettings = {
  accounts: { issuer: "http://localhost:3000", signingKey: Option.none() },
  mcp: Option.none(),
};

export const newKeyCommand =
  "node -e \"crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(JSON.stringify(j)))\"";

const refuse = (message: string) =>
  Effect.fail(new Config.ConfigError(new SourceError({ message })));

const text = (name: string) => Config.String(name).pipe(Config.withDefault(""));

const signingKey = Config.Redacted("ACCOUNTS_SIGNING_KEY").pipe(
  Config.option,
  Config.map(Option.filter((key) => Redacted.value(key).trim() !== "")),
);

const issuerOf = (configured: string, appOrigin: string, port: number): string => {
  if (configured !== "") return configured;
  if (URL.canParse(appOrigin)) return new URL(appOrigin).origin;
  return `http://localhost:${port}`;
};

export const signInConfig: Config.Config<SignInSettings> = Config.all({
  signingKey,
  issuer: text("ACCOUNTS_ISSUER"),
  appOrigin: text("APP_ORIGIN"),
  port: Config.Number("PORT").pipe(Config.withDefault(3000)),
  nodeEnv: text("NODE_ENV"),
  mcpIssuer: text("MCP_AUTH_ISSUER"),
}).pipe(
  Config.mapEffect(
    ({
      signingKey,
      issuer,
      appOrigin,
      port,
      nodeEnv,
      mcpIssuer,
    }): Effect.Effect<SignInSettings, Config.ConfigError> => {
      // A temporary key would sign tokens nobody can check after a restart, so production needs one.
      if (Option.isNone(signingKey) && nodeEnv === "production") {
        return refuse(
          `ACCOUNTS_SIGNING_KEY is required when NODE_ENV=production. Put a private EC P-256 JWK in .env.local; make one with: ${newKeyCommand}`,
        );
      }
      return Effect.succeed({
        accounts: { issuer: issuerOf(issuer, appOrigin, port), signingKey },
        mcp: mcpIssuer === "" ? Option.none() : Option.some({ issuer: mcpIssuer }),
      });
    },
  ),
);

const neutralName = "New member";

const displayNameOf = (principal: Principal): string => {
  // Only the `name` claim names a person: an email never names or links anyone.
  const name = principal.claims["name"];
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length >= 1 && trimmed.length <= 120 ? trimmed : neutralName;
};

const signInFailed = new Refused({
  status: 503,
  code: "sign_in_failed",
  message: "Your account could not be created right now. Try again.",
});

export const createPersonOnFirstSignIn: Layer.Layer<
  FirstSignIn,
  never,
  Identity | Party | UnitOfWork
> = Layer.effect(
  FirstSignIn,
  Effect.gen(function* firstSignIn() {
    const identity = yield* Identity;
    const party = yield* Party;
    const unitOfWork = yield* UnitOfWork;
    return (principal) => {
      const login = { issuer: principal.issuer, subject: principal.subject };
      const signUp = unitOfWork.atomic(
        Effect.gen(function* signUp() {
          const person = yield* party.createPerson({ displayName: displayNameOf(principal) });
          yield* identity.bind(login, person.id);
          return person.id;
        }),
      );
      return signUp.pipe(
        Effect.tap((id) =>
          Effect.logInfo(`First sign-in: Person ${id} created for ${login.subject}`),
        ),
        // A parallel first request bound this login first; its unit won and this one rolled back.
        Effect.catchTag("BindingTaken", () =>
          identity.resolve(login).pipe(Effect.flatMap(Effect.fromOption)),
        ),
        Effect.tapError((error) => Effect.logError("First sign-in failed", error)),
        Effect.mapError(() => signInFailed),
      );
    };
  }),
);

const accountsIssuer = (
  settings: AccountsSettings,
): Layer.Layer<AccountsIssuer, AccountsIssuerConfigInvalid> =>
  Option.match(settings.signingKey, {
    // Development only: signInConfig refuses a missing key in production.
    onNone: () => AccountsIssuer.ephemeral({ issuer: settings.issuer }),
    onSome: (key) => AccountsIssuer.layer({ issuer: settings.issuer, signingKey: key }),
  });

const webAuthenticator: Layer.Layer<Authenticator, AuthJwtConfigInvalid, AccountsIssuer> =
  Layer.unwrap(
    Effect.gen(function* webAuthenticator() {
      const issuer = yield* AccountsIssuer;
      return AuthJwt.layer({ issuer: issuer.issuer, jwks: issuer.jwks });
    }),
  );

export const signInLayer = <R>(
  settings: SignInSettings,
  accounts: Layer.Layer<Accounts, never, AccountsIssuer | R>,
): Layer.Layer<
  Accounts | AccountsIssuer | Authenticator | FirstSignIn | McpAuthenticator,
  AuthJwtConfigInvalid | AccountsIssuerConfigInvalid,
  Identity | Party | UnitOfWork | Exclude<R, AccountsIssuer>
> =>
  Layer.mergeAll(
    accounts,
    webAuthenticator,
    createPersonOnFirstSignIn,
    McpAuthenticator.layer(settings.mcp),
  ).pipe(Layer.provideMerge(accountsIssuer(settings.accounts)));
