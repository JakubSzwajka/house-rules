import { CurrentActor, implement } from "@house-rules/application";
import { Party } from "@house-rules/party";
import { showPerson as contract } from "@house-rules/party/contract";
import { Effect } from "effect";

export const showPerson = implement(contract, ({ id }) =>
  Effect.gen(function* showPersonHandler() {
    const party = yield* Party;
    const actor = yield* CurrentActor;
    return yield* party.get(actor, id);
  }),
);
