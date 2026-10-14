import {
  Authenticator,
  type Caller,
  CurrentActor,
  Grant,
  type GrantService,
  type Principal,
  Refused,
  type TokenSource,
  tokenFrom,
} from "@house-rules/application";
import type { Actor } from "@house-rules/domain";
import { Context, Effect, Option } from "effect";
import { ActorResolver } from "./actor-resolver.js";
import { FirstSignIn } from "./first-sign-in.js";

export type IdentityCallerOptions = Readonly<{
  token: TokenSource;
  audience?: string;
  grant: (
    actor: Actor,
    principal: Principal,
  ) => GrantService | Effect.Effect<GrantService, Refused>;
  challenge?: (error?: "invalid_token") => string;
}>;

export type IdentityCaller = Caller<
  CurrentActor | Grant,
  Authenticator | ActorResolver | FirstSignIn
>;

const isEffect = (
  granted: GrantService | Effect.Effect<GrantService, Refused>,
): granted is Effect.Effect<GrantService, Refused> => Effect.isEffect(granted);

export const identityCaller =
  (options: IdentityCallerOptions): IdentityCaller =>
  (incoming) =>
    Effect.gen(function* identityCallerOf() {
      const challenge = (error?: "invalid_token") =>
        options.challenge === undefined ? {} : { challenge: options.challenge(error) };
      const token = tokenFrom(incoming, options.token);
      if (Option.isNone(token)) {
        return yield* new Refused({
          status: 401,
          code: "token_missing",
          message: "Send a token to call this server.",
          ...challenge(),
        });
      }
      const authenticator = yield* Authenticator;
      const principal = yield* authenticator
        .verify(token.value, options.audience === undefined ? {} : { audience: options.audience })
        .pipe(
          Effect.mapError((rejected) =>
            rejected.reason === "unavailable"
              ? new Refused({
                  status: 503,
                  code: "auth_unavailable",
                  message: "The token could not be checked right now. Try again.",
                })
              : new Refused({
                  status: 401,
                  code: "token_invalid",
                  message: "The token is invalid, expired, or not issued for this server.",
                  ...challenge("invalid_token"),
                }),
          ),
        );
      const resolver = yield* ActorResolver;
      const known = yield* resolver.resolve(principal).pipe(
        Effect.mapError((error) =>
          error._tag === "ForeignIssuer"
            ? new Refused({
                status: 401,
                code: "token_invalid",
                message: "The token is invalid, expired, or not issued for this server.",
                ...challenge("invalid_token"),
              })
            : new Refused({
                status: 503,
                code: "identity_unavailable",
                message: "The account could not be looked up right now. Try again.",
              }),
        ),
      );
      const firstSignIn = yield* FirstSignIn;
      const id = Option.isSome(known) ? known.value : yield* firstSignIn(principal);
      const actor: Actor = { id };
      const granted = options.grant(actor, principal);
      const grant = isEffect(granted) ? yield* granted : granted;
      return Context.make(CurrentActor, actor).pipe(Context.add(Grant, grant));
    });
