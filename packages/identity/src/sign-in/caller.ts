import { type WhoSocket, Refused, type TokenSource, tokenFrom } from "@house-rules/application";
import type { Actor } from "@house-rules/domain";
import { Effect, Option } from "effect";
import { ActorResolver } from "./actor-resolver.js";
import { FirstSignIn } from "./first-sign-in.js";
import { ActorStanding } from "./actor-standing.js";
import { Credentials, type AcceptedKind } from "./credentials.js";

export type IdentityWhoOptions = Readonly<{
  token: TokenSource;
  accept?: ReadonlyArray<AcceptedKind>;
  requireScope?: string;
  audience?: string;
  challenge?: (error?: "invalid_token") => string;
}>;

export const identityWho = (
  options: IdentityWhoOptions,
): WhoSocket<Credentials | ActorResolver | FirstSignIn | ActorStanding> => ({
  resolve: (incoming) =>
    Effect.gen(function* identityWhoOf() {
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
      const credentials = yield* Credentials;
      const verified = yield* credentials
        .verify(token.value, {
          accept: options.accept ?? ["session", "jwt"],
          ...(options.audience === undefined ? {} : { audience: options.audience }),
        })
        .pipe(
          Effect.tapError((rejected) =>
            Effect.logWarning("Identity credential verification refused.").pipe(
              Effect.annotateLogs({
                reason: rejected._tag === "TokenRejected" ? rejected.reason : rejected._tag,
              }),
            ),
          ),
          Effect.mapError((rejected) =>
            rejected._tag === "IdentityStoreUnavailable"
              ? new Refused({
                  status: 503,
                  code: "identity_unavailable",
                  message: "The account could not be looked up right now. Try again.",
                })
              : rejected.reason === "unavailable"
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
      const principal = verified.principal;
      const known = Option.isSome(verified.actorId)
        ? verified.actorId
        : yield* Effect.gen(function* () {
            const resolver = yield* ActorResolver;
            return yield* resolver.resolve(principal);
          }).pipe(
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
      const id = Option.isSome(known)
        ? known.value
        : yield* Effect.gen(function* () {
            const firstSignIn = yield* FirstSignIn;
            return yield* firstSignIn(principal);
          });
      const standing = yield* ActorStanding;
      const status = yield* standing.check(id).pipe(
        Effect.mapError(
          () =>
            new Refused({
              status: 503,
              code: "identity_unavailable",
              message: "The account could not be looked up right now. Try again.",
            }),
        ),
      );
      if (status !== "active")
        return yield* new Refused({
          status: 401,
          code: status === "disabled" ? "actor_disabled" : "token_invalid",
          message:
            status === "disabled"
              ? "This account is disabled."
              : "The token is invalid, expired, or not issued for this server.",
          ...challenge("invalid_token"),
        });
      if (options.requireScope !== undefined && !principal.scopes.includes(options.requireScope))
        return yield* new Refused({
          status: 403,
          code: "scope_too_wide",
          message: "The token does not allow this scope.",
        });
      const actor: Actor = { id };
      return actor;
    }),
});
