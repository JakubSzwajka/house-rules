import { implement, Viewer } from "@house-rules/capability";
import { Comments } from "@house-rules/comments";
import { listComments as contract } from "@house-rules/comments/contract";
import { Effect } from "effect";

export const listComments = implement(contract, ({ target, page }) =>
  Effect.gen(function* () {
    const comments = yield* Comments;
    const actor = yield* Viewer;
    return yield* comments.list(actor, target, page);
  }),
);
