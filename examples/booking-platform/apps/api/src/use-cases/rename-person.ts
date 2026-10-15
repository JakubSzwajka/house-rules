import { CurrentActor, implement } from "@house-rules/application";
import { Party } from "@house-rules/party";
import { renamePerson as contract } from "@house-rules/party/contract";
import { Effect } from "effect";

export const renamePerson = implement(contract, ({ id, displayName }) =>
  Effect.gen(function* renamePersonHandler() {
    const party = yield* Party;
    const actor = yield* CurrentActor;
    return yield* party.rename(actor, id, displayName);
  }),
);
