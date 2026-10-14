import { implement, CurrentActor } from "@house-rules/application";
import { Comments } from "@house-rules/comments";
import { editComment as contract } from "@house-rules/comments/contract";
import { Effect } from "effect";

export const editComment = implement(contract, ({ id, body }) =>
  Effect.gen(function* () {
    const comments = yield* Comments;
    const actor = yield* CurrentActor;
    return yield* comments.edit(actor, id, body);
  }),
);
