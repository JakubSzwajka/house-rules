import { implement, Viewer } from "@house-rules/capability";
import { Comments } from "@house-rules/comments";
import { addComment as contract } from "@house-rules/comments/contract";
import { Effect } from "effect";

export const addComment = implement(contract, ({ target, body }) =>
  Effect.gen(function* () {
    const comments = yield* Comments;
    const actor = yield* Viewer;
    return yield* comments.add(actor, target, body);
  }),
);
