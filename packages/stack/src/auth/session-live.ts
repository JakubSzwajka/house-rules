import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { PersonId } from "../actor/actor.ts";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { Roles } from "../access/roles.ts";
import { AuthProvider } from "./auth-provider.ts";
import { Session, Unauthenticated } from "./session.middleware.ts";

export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const auth = yield* AuthProvider;
    const roles = yield* Roles;
    return (effect, { headers }) =>
      auth.authenticate(headers).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new Unauthenticated()),
            // authorOf writes system actors as "system:<name>"; a subject like that could pose as one.
            onSome: (principal) =>
              principal.subject.startsWith("system:")
                ? Effect.fail(new Unauthenticated())
                : Effect.provideService(effect, CurrentActor, {
                    _tag: "Person",
                    id: PersonId.make(principal.subject),
                    orgId: principal.orgId,
                    roles: [...principal.roles],
                    permissions: [...roles.permissionsOf(principal.roles)],
                  }),
          }),
        ),
      );
  }),
);
