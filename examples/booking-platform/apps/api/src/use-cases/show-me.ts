import { CurrentActor, implement } from "@house-rules/application";
import { Party } from "@house-rules/party";
import { showMe as contract } from "@house-rules/party/contract";
import { Effect } from "effect";

export const showMe = implement(contract, () =>
  Effect.gen(function* showMeHandler() {
    const party = yield* Party;
    return yield* party.me(yield* CurrentActor);
  }),
);
