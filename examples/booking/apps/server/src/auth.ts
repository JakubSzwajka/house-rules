import { BookingRoles } from "@example/booking-domain";
import { AuthProvider, clerk, devTokens, type Principal, Roles } from "@house-rules/stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export const DEV_TOKENS: Readonly<Record<string, Principal>> = {
  "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
  "carol-token": { subject: "carol", orgId: "acme", roles: ["member"] },
  "dave-token": { subject: "dave", orgId: "acme", roles: ["org-admin"] },
  "gus-token": { subject: "gus", orgId: null, roles: ["guest"] },
};

export const BookingRolesLive = Roles.layer({
  ...BookingRoles,
  "org:member": BookingRoles.member,
  "org:admin": BookingRoles["org-admin"],
});

export const everyoneIsMember = <E, R>(provider: Layer.Layer<AuthProvider, E, R>) =>
  Layer.effect(
    AuthProvider,
    Effect.gen(function* () {
      const inner = yield* AuthProvider;
      return {
        authenticate: (headers) =>
          inner.authenticate(headers).pipe(
            Effect.map(
              Option.map((principal) => ({
                ...principal,
                roles: [...new Set(["member", ...principal.roles])],
              })),
            ),
          ),
      };
    }),
  ).pipe(Layer.provide(provider));

const commaList = (value: string) =>
  value
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "");

export const ClerkFromEnv = (issuer: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const jwtKey = yield* Config.option(Config.NonEmptyString("CLERK_JWT_KEY"));
      const parties = yield* Config.option(Config.NonEmptyString("CLERK_AUTHORIZED_PARTIES"));
      return everyoneIsMember(
        clerk({
          issuer,
          jwtKey: Option.getOrUndefined(jwtKey),
          authorizedParties: Option.getOrUndefined(Option.map(parties, commaList)),
        }),
      );
    }),
  );

export const AuthFromEnv = Layer.unwrap(
  Effect.gen(function* () {
    const issuer = yield* Config.option(Config.NonEmptyString("CLERK_ISSUER"));
    return Option.isSome(issuer) ? ClerkFromEnv(issuer.value) : devTokens(DEV_TOKENS);
  }),
);

export const ClerkAuth = Layer.unwrap(
  Effect.gen(function* () {
    return ClerkFromEnv(yield* Config.NonEmptyString("CLERK_ISSUER"));
  }),
);
