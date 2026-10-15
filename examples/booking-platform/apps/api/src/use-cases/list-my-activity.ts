import { Activity, listMyActivityContract } from "@example/activity";
import { CurrentActor, implement } from "@house-rules/application";
import { Effect } from "effect";

export const listMyActivity = implement(listMyActivityContract, (query) =>
  Effect.gen(function* listMyActivityHandler() {
    const activity = yield* Activity;
    return yield* activity.mine(yield* CurrentActor, query);
  }),
);
