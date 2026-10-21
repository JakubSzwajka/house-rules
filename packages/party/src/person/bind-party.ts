import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import type { makeParty } from "./party.js";
import { PartyOperations } from "./operations.js";
import { PersonCallerDenied, PersonNotFound, PersonUpdateRefused } from "./person.js";

export const bindParty = (service: ReturnType<typeof makeParty>): readonly Binding[] => [
  bindOperation(PartyOperations.createPerson, (input, { caller }) =>
    caller.kind === "system" ? service.createPerson(input) : Effect.fail(new PersonCallerDenied()),
  ),
  bindOperation(PartyOperations.showPerson, ({ id }, { caller }) =>
    caller.kind === "person" ? service.get(caller.actor, id) : Effect.fail(new PersonNotFound()),
  ),
  bindOperation(PartyOperations.showMe, (_input, { caller }) =>
    caller.kind === "person" ? service.me(caller.actor) : Effect.fail(new PersonNotFound()),
  ),
  bindOperation(PartyOperations.renamePerson, ({ id, displayName }, { caller }) =>
    caller.kind === "person"
      ? service.rename(caller.actor, id, displayName)
      : Effect.fail(new PersonUpdateRefused()),
  ),
];
