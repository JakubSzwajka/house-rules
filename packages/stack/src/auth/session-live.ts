import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type Actor, AgentId, PersonId } from "../actor/actor.ts";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { Roles } from "../access/roles.ts";
import { AuthProvider } from "./auth-provider.ts";
import type { Principal } from "./principal.ts";
import { Session, Unauthenticated } from "./session.middleware.ts";

const posesAsSystem = (id: string) => id.startsWith("system:");
const isPersonId = Schema.is(PersonId);
const isAgentId = Schema.is(AgentId);

const actorOf = (
  principal: Principal,
  permissions: ReadonlyArray<string>,
): Option.Option<Actor> => {
  // authorOf writes system actors as "system:<name>"; a subject like that could pose as one.
  if (posesAsSystem(principal.subject)) return Option.none();
  const roles = [...principal.roles];
  if (principal.agent === undefined) {
    if (!isPersonId(principal.subject)) return Option.none();
    return Option.some({
      _tag: "Person",
      id: PersonId.make(principal.subject),
      orgId: principal.orgId,
      roles,
      permissions: [...permissions],
    });
  }
  const { name, forPerson } = principal.agent;
  if (
    !isAgentId(principal.subject) ||
    !isPersonId(forPerson) ||
    forPerson === "" ||
    posesAsSystem(forPerson)
  )
    return Option.none();
  return Option.some({
    _tag: "Agent",
    id: AgentId.make(principal.subject),
    name: name === "" ? principal.subject : name,
    forPerson: PersonId.make(forPerson),
    orgId: principal.orgId,
    roles,
    permissions: [...permissions],
  });
};

export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const auth = yield* AuthProvider;
    const roles = yield* Roles;
    return (effect, { headers }) =>
      auth.authenticate(headers).pipe(
        Effect.flatMap((principal) =>
          Option.match(
            Option.flatMap(principal, (p) => actorOf(p, roles.permissionsOf(p.roles))),
            {
              onNone: () => Effect.fail(new Unauthenticated()),
              onSome: (actor) => Effect.provideService(effect, CurrentActor, actor),
            },
          ),
        ),
      );
  }),
);
