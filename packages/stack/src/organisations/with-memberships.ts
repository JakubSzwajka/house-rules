import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AuthProvider } from "../auth/auth-provider.ts";
import type { Principal } from "../auth/principal.ts";
import { Organisation } from "./organisation.aggregate.ts";
import { OrgId } from "./organisation.id.ts";

export const withMemberships = <E, R>(provider: Layer.Layer<AuthProvider, E, R>) =>
  Layer.effect(
    AuthProvider,
    Effect.gen(function* () {
      const auth = yield* AuthProvider;
      const organisations = yield* Organisation;
      const withRole = (principal: Principal) =>
        principal.orgId === null
          ? Effect.succeed(principal)
          : Effect.map(organisations.state(OrgId.make(principal.orgId)), (s) => {
              const role =
                s._tag === "Founded" && Object.hasOwn(s.members, principal.subject)
                  ? s.members[principal.subject]
                  : undefined;
              return role === undefined || principal.roles.includes(role)
                ? principal
                : { ...principal, roles: [...principal.roles, role] };
            });
      return {
        authenticate: (headers) =>
          auth.authenticate(headers).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeedNone,
                onSome: (principal) => Effect.asSome(withRole(principal)),
              }),
            ),
          ),
      };
    }),
  ).pipe(Layer.provide(provider));
