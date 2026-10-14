import { implement, CurrentActor } from "@house-rules/application";
import { Comments } from "@house-rules/comments";
import { removeComment as contract } from "@house-rules/comments/contract";
import { Effect } from "effect";

export const removeComment = implement(contract, ({ id }) =>
  Effect.gen(function* () {
    const comments = yield* Comments;
    const actor = yield* CurrentActor;
    return yield* comments.remove(actor, id);
  }),
);
