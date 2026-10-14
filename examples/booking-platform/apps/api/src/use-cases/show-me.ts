import { showMeContract } from "@example/dev-sign-in";
import { CurrentActor, implement } from "@house-rules/application";
import { Party } from "@house-rules/party";
import { Effect } from "effect";

export const showMe = implement(showMeContract, () =>
  Effect.gen(function* showMeHandler() {
    const party = yield* Party;
    const actor = yield* CurrentActor;
    return yield* party.get(actor, actor.id);
  }),
);
