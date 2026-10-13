import { UnitOfWork } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { CommentStore } from "../../storage.js";
import {
  type Comment,
  CommentStoreUnavailable,
  type CommentTarget,
} from "../../comment/comment.js";

const copy = (comment: Comment): Comment => ({ ...comment, target: { ...comment.target } });
const sameTarget = (comment: Comment, ref: CommentTarget) =>
  comment.target.kind === ref.kind && comment.target.id === ref.id;

export const memoryCommentStore = (): Layer.Layer<CommentStore> =>
  Layer.sync(CommentStore, () => {
    const rows = new Map<string, Comment>();
    const change = Effect.fn("CommentStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map(rows);
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, comment] of before) rows.set(id, comment);
        }),
      );
      run();
    });
    return CommentStore.of({
      find: (id) =>
        Effect.sync(() => {
          const comment = rows.get(id);
          return comment === undefined ? undefined : copy(comment);
        }),
      list: (ref, page) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter(
              (comment) =>
                sameTarget(comment, ref) &&
                (page.after === undefined ||
                  comment.createdAt > page.after.createdAt ||
                  (comment.createdAt === page.after.createdAt && comment.id > page.after.id)),
            )
            .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1))
            .slice(0, page.size)
            .map(copy),
        ),
      insert: Effect.fn("CommentStore.memory.insert")(function* (comment: Comment) {
        yield* UnitOfWork.required;
        if (rows.has(comment.id))
          return yield* new CommentStoreUnavailable({ cause: "Duplicate comment id." });
        yield* change(() => void rows.set(comment.id, copy(comment)));
      }),
      edit: Effect.fn("CommentStore.memory.edit")(function* (
        id: string,
        body: string,
        editedAt: number,
      ) {
        yield* UnitOfWork.required;
        const comment = rows.get(id);
        if (comment === undefined) return undefined;
        const edited = { ...comment, body, editedAt };
        yield* change(() => void rows.set(id, edited));
        return copy(edited);
      }),
      remove: (id) => change(() => void rows.delete(id)),
      removeTarget: (ref) =>
        change(() => {
          for (const [id, comment] of rows) if (sameTarget(comment, ref)) rows.delete(id);
        }),
      erase: (authorId) =>
        change(() => {
          for (const [id, comment] of rows) if (comment.authorId === authorId) rows.delete(id);
        }),
    });
  });
