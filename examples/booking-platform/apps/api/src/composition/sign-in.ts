import { Authenticator, type Principal, Refused, TokenRejected } from "@house-rules/application";
import { AuthJwt, type AuthJwtConfigInvalid, type AuthJwtOptions } from "@house-rules/auth-jwt";
import { UnitOfWork } from "@house-rules/domain";
import { FirstSignIn, Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { Config, Effect, Layer, Option } from "effect";

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
  auth: Option.Option<AuthJwtOptions>,
): Layer.Layer<Authenticator | FirstSignIn, AuthJwtConfigInvalid, Identity | Party | UnitOfWork> =>
  Option.match(auth, {
    onNone: () => Layer.merge(refuseEveryToken, Identity.refuse),
    onSome: (options) => Layer.merge(AuthJwt.layer(options), createPersonOnFirstSignIn),
  });
