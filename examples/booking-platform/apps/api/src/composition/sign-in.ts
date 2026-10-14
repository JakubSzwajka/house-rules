import { Authenticator, type Principal, Refused, TokenRejected } from "@house-rules/application";
import { DevSignIn } from "@example/dev-sign-in";
import {
  AuthJwt,
  type AuthJwtConfigInvalid,
  AuthJwtLocal,
  type AuthJwtOptions,
} from "@house-rules/auth-jwt";
import { UnitOfWork } from "@house-rules/domain";
import { FirstSignIn, Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { Config, Effect, Layer, Option } from "effect";
import { SourceError } from "effect/ConfigProvider";

export const authConfig: Config.Config<Option.Option<AuthJwtOptions>> = Config.all({
  issuer: Config.String("AUTH_ISSUER").pipe(Config.withDefault("")),
  audience: Config.String("AUTH_AUDIENCE").pipe(Config.withDefault("")),
}).pipe(
  Config.map(({ issuer, audience }) =>
    issuer === ""
      ? Option.none()
      : Option.some({ issuer, ...(audience === "" ? {} : { audience }) }),
  ),
);

export type SignInMode =
  | Readonly<{ kind: "visitor" }>
  | Readonly<{ kind: "jwt"; options: AuthJwtOptions }>
  | Readonly<{ kind: "dev" }>;

export const visitorMode: SignInMode = { kind: "visitor" };
export const devMode: SignInMode = { kind: "dev" };
export const jwtMode = (options: AuthJwtOptions): SignInMode => ({ kind: "jwt", options });

const refuse = (message: string) =>
  Effect.fail(new Config.ConfigError(new SourceError({ message })));

const switchOn = (name: string, value: string) => {
  if (value === "" || value === "0" || value === "false") return Effect.succeed(false);
  if (value === "1" || value === "true") return Effect.succeed(true);
  return refuse(`${name} must be 1 or empty, not ${JSON.stringify(value)}.`);
};

export const signInConfig: Config.Config<SignInMode> = Config.all({
  auth: authConfig,
  devIssuer: Config.String("DEV_ISSUER").pipe(Config.withDefault("")),
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("")),
}).pipe(
  Config.mapEffect(({ auth, devIssuer, nodeEnv }) =>
    Effect.flatMap(
      switchOn("DEV_ISSUER", devIssuer),
      (dev): Effect.Effect<SignInMode, Config.ConfigError> => {
        if (!dev)
          return Effect.succeed(Option.match(auth, { onNone: () => visitorMode, onSome: jwtMode }));
        // Whoever reaches the dev issuer can sign in as anyone, so production never starts with it.
        if (nodeEnv === "production") {
          return refuse("DEV_ISSUER=1 is refused when NODE_ENV=production.");
        }
        if (Option.isSome(auth)) {
          return refuse("Set AUTH_ISSUER or DEV_ISSUER=1, not both.");
        }
        return Effect.succeed(devMode);
      },
    ),
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

export const refuseEveryToken: Layer.Layer<Authenticator> = Layer.succeed(Authenticator, {
  verify: () => Effect.fail(new TokenRejected({ reason: "invalid" })),
});

export const signInLayer = (
  mode: SignInMode,
): Layer.Layer<
  Authenticator | FirstSignIn | DevSignIn,
  AuthJwtConfigInvalid,
  Identity | Party | UnitOfWork
> => {
  switch (mode.kind) {
    case "visitor":
      return Layer.mergeAll(refuseEveryToken, Identity.refuse, DevSignIn.off);
    case "jwt":
      return Layer.mergeAll(AuthJwt.layer(mode.options), createPersonOnFirstSignIn, DevSignIn.off);
    case "dev":
      // One local key pair signs the dev tokens and verifies them: the normal member caller reads them.
      return Layer.mergeAll(DevSignIn.layer, createPersonOnFirstSignIn).pipe(
        Layer.provideMerge(AuthJwtLocal.layer()),
      );
  }
};
