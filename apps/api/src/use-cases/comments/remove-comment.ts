import { implement, Viewer } from "@house-rules/capability";
import { Comments } from "@house-rules/comments";
import { removeComment as contract } from "@house-rules/comments/contract";
import { Effect } from "effect";

export const removeComment = implement(contract, ({ id }) =>
  Effect.gen(function* () {
    const comments = yield* Comments;
    const actor = yield* Viewer;
    return yield* comments.remove(actor, id);
  }),
);
