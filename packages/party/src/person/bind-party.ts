import { type Binding, bindNode } from "@house-rules/application";
import { Effect } from "effect";
import type { makeParty } from "./party.js";
import { createPerson, renamePerson, showMe, showPerson } from "./nodes.js";
import { PersonCallerDenied, PersonNotFound, PersonUpdateRefused } from "./person.js";

export const bindParty = (service: ReturnType<typeof makeParty>): readonly Binding[] => [
  bindNode(createPerson, (input, { caller }) =>
    caller.kind === "system" ? service.createPerson(input) : Effect.fail(new PersonCallerDenied()),
  ),
  bindNode(showPerson, ({ id }, { caller }) =>
    caller.kind === "person" ? service.get(caller.actor, id) : Effect.fail(new PersonNotFound()),
  ),
  bindNode(showMe, (_input, { caller }) =>
    caller.kind === "person" ? service.me(caller.actor) : Effect.fail(new PersonNotFound()),
  ),
  bindNode(renamePerson, ({ id, displayName }, { caller }) =>
    caller.kind === "person"
      ? service.rename(caller.actor, id, displayName)
      : Effect.fail(new PersonUpdateRefused()),
  ),
];
